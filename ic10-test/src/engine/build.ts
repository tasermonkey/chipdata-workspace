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
import { writeProp, writePropIfPresent } from "./device.ts";

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
	/** Chips by their housing's reference ID. */
	chips: Map<number, EngineChip>;
}

/**
 * Build the emulator objects for a world. Goes through the emulator's env format, so prefab and
 * property names get its validation, then gives every chip a runner with no jump limit (the
 * harness has its own budgets) and resets it for a real run.
 */
export function buildEngine(spec: EngineSpec): Engine {
	const all = [...spec.housings, ...spec.devices];
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

	let builder: Builder;
	try {
		builder = Builder.from(JSON.stringify(env));
	} catch (error) {
		const ids = all.map((d) => `${d.key}=${d.id}`).join(", ");
		throw new Error(`sim: the emulator rejected the world: ${(error as Error).message} (device IDs: ${ids})`);
	}

	const chips = new Map<number, EngineChip>();
	for (const housingSpec of spec.housings) {
		const housing = builder.Devices.get(housingSpec.id);
		if (!(housing instanceof Housing)) {
			throw new Error(`sim: "${housingSpec.key}" (${housingSpec.prefab}) can't hold a chip`);
		}
		const runner = new Ic10Runner({ housing, jumpLimit: Number.POSITIVE_INFINITY, randomSeed: spec.seed });
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
				`sim: "${housingSpec.key}" line ${line}: ${parseError.message}: ${JSON.stringify(runner.lines[line]?.originalText ?? "")}`,
			);
		}

		for (const [prop, value] of Object.entries(housingSpec.props)) {
			try {
				writeProp(housing, prop, value);
			} catch (error) {
				throw new Error(`sim: "${housingSpec.key}": ${(error as Error).message}`);
			}
		}
		chips.set(housingSpec.id, new EngineChip(runner, housing));
	}

	// The game sets these on every device; the emulator leaves them unset (or reset).
	for (const device of builder.Devices.values()) {
		writePropIfPresent(device, "ReferenceId", device.id);
		writePropIfPresent(device, "PrefabHash", device.hash);
	}

	return { builder, devices: builder.Devices, chips };
}
