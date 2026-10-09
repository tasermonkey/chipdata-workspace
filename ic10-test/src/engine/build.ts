import {
	Builder,
	type Device,
	EmptyLine,
	type EnvSchema,
	ErrorSeverity,
	Housing,
	Ic10Runner,
} from "@stationeers-ic/ic10";
import { EngineChip } from "./chip.ts";
import { listProps, writeProp, writePropIfPresent } from "./device.ts";

export interface EngineDeviceSpec {
	/** Test-side key, used in error messages. */
	key: string;
	id: number;
	prefab: string;
	/** In-game name (for `lbn` / `sbn`). */
	name?: string;
	network: string;
	props: Record<string, number>;
}

export interface EngineHousingSpec extends EngineDeviceSpec {
	code: string;
	/** Pin (`d0`–`d5`) to the reference ID of the device on it. */
	pins: Record<string, number>;
}

export interface EngineSpec {
	networks: string[];
	devices: EngineDeviceSpec[];
	housings: EngineHousingSpec[];
	/** Seed for `rand`, so runs are repeatable. */
	seed: number;
}

export interface Engine {
	builder: Builder;
	/** Every device, housings included, by reference ID. */
	devices: Map<number, Device>;
	/** Chips by their housing's reference ID, in the env's device order. */
	chips: Map<number, EngineChip>;
}

/**
 * Build the emulator objects for a `sim()` world. Goes through the emulator's env format, so prefab
 * and property names get its validation.
 */
export function buildEngine(spec: EngineSpec): Engine {
	const port = (network: string) => [{ port: "default", network }];
	const env = {
		version: 1,
		chips: spec.housings.map((housing, i) => ({ id: i + 1, code: housing.code })),
		networks: spec.networks.map((id) => ({ id, type: "data" })),
		devices: [
			...spec.housings.map((housing, i) => ({
				id: housing.id,
				PrefabName: housing.prefab,
				chip: i + 1,
				...(housing.name !== undefined && { name: housing.name }),
				ports: port(housing.network),
				pins: Object.entries(housing.pins).map(([pin, device]) => ({ pin, device })),
			})),
			...spec.devices.map((device) => ({
				id: device.id,
				PrefabName: device.prefab,
				...(device.name !== undefined && { name: device.name }),
				ports: port(device.network),
				props: Object.entries(device.props).map(([name, value]) => ({ name, value })),
			})),
		],
	} as EnvSchema;

	const keys = new Map([...spec.housings, ...spec.devices].map((d) => [d.id, d.key]));
	const engine = buildEngineFromEnv(env, spec.seed, (id) => keys.get(id) ?? String(id));

	// A housing's own properties are written after its chip is reset, with the harness's messages.
	for (const housingSpec of spec.housings) {
		const housing = engine.devices.get(housingSpec.id)!;
		for (const [prop, value] of Object.entries(housingSpec.props)) {
			try {
				writeProp(housing, prop, value);
			} catch (error) {
				throw new Error(`sim: "${housingSpec.key}": ${(error as Error).message}`);
			}
		}
	}
	return engine;
}

/**
 * Build the emulator objects from env JSON. Every housing with a chip gets a runner with no jump
 * limit (the harness has its own budgets), reset for a real run; the chip's starting registers and
 * stack, and the housing's properties, are kept. `keyOf` names a device in error messages.
 */
export function buildEngineFromEnv(env: EnvSchema | string, seed: number, keyOf: (id: number) => string): Engine {
	let builder: Builder;
	try {
		builder = Builder.from(typeof env === "string" ? env : JSON.stringify(env));
	} catch (error) {
		const ids = typeof env === "string" ? "" : ` (device IDs: ${env.devices.map((d) => `${keyOf(d.id)}=${d.id}`).join(", ")})`;
		throw new Error(`sim: the emulator rejected the world: ${(error as Error).message}${ids}`);
	}

	const chips = new Map<number, EngineChip>();
	for (const [id, device] of builder.Devices) {
		if (!(device instanceof Housing) || !device.chip) continue;
		const chip = device.chip;
		const registers = new Map(chip.registers);
		const stack = chip.memory.toArray();
		const props = listProps(device);

		const runner = new Ic10Runner({ housing: device, jumpLimit: Number.POSITIVE_INFINITY, randomSeed: seed });
		runner.switchContext("real");
		runner.init(); // resets the chip and the housing's own properties

		const parseError = runner.context.errors.find(
			(e) => e.severity === ErrorSeverity.Strong || e.severity === ErrorSeverity.Critical,
		);
		if (parseError) {
			// The emulator stamps errors with the line last executed, so find the bad line itself: the
			// lexer turns a line it can't parse into an empty one.
			const unparsed = runner.lines.findIndex((l) => l instanceof EmptyLine && l.originalText.trim() !== "");
			const line = unparsed >= 0 ? unparsed : (parseError.line ?? 0);
			throw new Error(
				`sim: "${keyOf(id)}" line ${line}: ${parseError.message}: ${JSON.stringify(runner.lines[line]?.originalText ?? "")}`,
			);
		}

		for (const [index, value] of registers) chip.registers.set(index, value);
		for (const value of stack) chip.memory.push(value);
		for (const [prop, value] of Object.entries(props)) writePropIfPresent(device, prop, value);
		// A housing someone built a chip into is normally switched on; the emulator leaves On at 0.
		if (!("On" in props)) writePropIfPresent(device, "On", 1);
		chips.set(id, new EngineChip(runner, device));
	}

	// The game sets these on every device; the emulator leaves them unset (or reset).
	for (const device of builder.Devices.values()) {
		writePropIfPresent(device, "ReferenceId", device.id);
		writePropIfPresent(device, "PrefabHash", device.hash);
	}

	return { builder, devices: builder.Devices, chips };
}
