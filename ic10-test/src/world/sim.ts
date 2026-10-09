import { resolve } from "node:path";
import { type DebugGate, getDefaultDebugGate } from "../debug/gate.ts";
import { buildEngine, type Engine, type EngineDeviceSpec, type EngineHousingSpec } from "../engine/build.ts";
import { isCatalogued } from "../engine/device.ts";
import { parseId, type ReferenceId } from "../engine/ids.ts";
import { ChipState, Scheduler } from "../scheduler/scheduler.ts";
import { readScript } from "../scripts.ts";
import { EventQueue } from "./events.ts";
import { type DeviceEntry, World } from "./world.ts";

export interface SimOptions {
	/** Lines a chip runs per tick before an automatic yield. Default 128, as in game. */
	linesPerTick?: number;
	/**
	 * Whether blank, comment and label lines use up the per-tick budget. Default true: they do in game
	 * (confirmed 2026-10-07). With false, only instruction lines count.
	 */
	countNonInstructionLines?: boolean;
	/** Game time per tick, in seconds. Default 0.5. */
	tickSeconds?: number;
	/** Ticks a `runUntil` / `runUntilLine` / `runToHalt` may take before failing. Default 10,000. */
	maxTicks?: number;
	/** Lines (all chips together) one run call may execute before failing. Default 1,000,000. */
	maxLinesPerRun?: number;
	/** Throw as soon as any chip halts, instead of leaving it for the test to assert on. Default false. */
	failOnHalt?: boolean;
	/** Directory `file:` paths are relative to. Default: the working directory. */
	root?: string;
	/** Seed for `rand`, so runs repeat exactly. Default 1. */
	seed?: number;
	/** A debugger to consult as the world runs; false for none. Default: the gate set with `setDefaultDebugGate`. */
	debug?: DebugGate | false;
	/** Executed lines kept for failure reports. Default 50. */
	traceLength?: number;
	/**
	 * Whether a chip whose housing is switched off and on again also loses its registers and stack.
	 * Default false: it restarts from line 0 and keeps them (not yet confirmed in game).
	 */
	restartClearsState?: boolean;
}

/** Where a device is and what it's called in game. */
export interface DeviceOptions {
	/** Reference ID: a number or the game's `$hex` form. Default: the next one in a fixed sequence. */
	id?: ReferenceId;
	/** In-game name, for `lbn` / `sbn`. Default: the prefab name. */
	name?: string;
	/** Data network id. May be left out when the world has one network. */
	network?: string;
	/**
	 * The device isn't in the emulator's catalogue (a console-mod display, say). Its PrefabHash is
	 * HASH(prefab), and it accepts every logic property, readable and writable. Devices only.
	 */
	custom?: boolean;
}

export type Pin = "d0" | "d1" | "d2" | "d3" | "d4" | "d5";

/** A chip housing and its program: exactly one of `file` or `code`. */
export interface HousingOptions extends DeviceOptions {
	/** Path to an `.ic10` file, relative to `root`. */
	file?: string;
	/** Inline IC10 source. */
	code?: string;
	/** Which device (by key) is on each pin. */
	pins?: Partial<Record<Pin, string>>;
	/** Housing prefab. Default `StructureCircuitHousing`. */
	prefab?: string;
	/** The housing's own logic properties (`db`). */
	props?: Record<string, number>;
	/** Overrides the world's `linesPerTick` for this chip. */
	linesPerTick?: number;
	/** Overrides the world's `countNonInstructionLines` for this chip. */
	countNonInstructionLines?: boolean;
	/** Overrides the world's `restartClearsState` for this chip. */
	restartClearsState?: boolean;
}

interface DeviceDecl {
	key: string;
	prefab: string;
	props: Record<string, number>;
	options: DeviceOptions;
	housing?: HousingOptions;
}

/** First automatic reference ID; later ones count up, skipping any given explicitly. */
const FIRST_AUTO_ID = 0x1001;
const PIN = /^d[0-5]$/;

/** Declares a world, then builds it. Start with `sim()`. */
export class SimBuilder {
	private readonly networks: string[] = [];
	private readonly decls: DeviceDecl[] = [];

	private readonly options: SimOptions;

	constructor(options: SimOptions = {}) {
		this.options = options;
	}

	/** Add a data network. A world without one gets a network called "data". */
	network(id: string): this {
		if (this.networks.includes(id)) throw new Error(`sim: network "${id}" is declared twice`);
		this.networks.push(id);
		return this;
	}

	/**
	 * Add a device. `props` are its logic properties (read-only ones included, as a sensor's
	 * readings); `options` give its reference ID, in-game name and network.
	 */
	device(key: string, prefab: string, props: Record<string, number> = {}, options: DeviceOptions = {}): this {
		this.decls.push({ key, prefab, props, options });
		return this;
	}

	/** Add a chip housing running a program, with devices on its pins. */
	housing(key: string, options: HousingOptions): this {
		this.decls.push({
			key,
			prefab: options.prefab ?? "StructureCircuitHousing",
			props: options.props ?? {},
			options,
			housing: options,
		});
		return this;
	}

	async build(): Promise<World> {
		const opts = this.options;
		const networks = this.networks.length > 0 ? this.networks : ["data"];
		const root = opts.root ?? process.cwd();

		const keys = new Set<string>();
		for (const decl of this.decls) {
			if (keys.has(decl.key)) throw new Error(`sim: "${decl.key}" is declared twice`);
			keys.add(decl.key);
			if (decl.housing && decl.options.custom) {
				throw new Error(`sim: housing "${decl.key}": a housing can't be custom`);
			}
			if (!decl.options.custom && !isCatalogued(decl.prefab)) {
				throw new Error(
					`sim: "${decl.key}": the emulator has no device ${decl.prefab}; for one it doesn't know, pass { custom: true }`,
				);
			}
		}

		const ids = this.assignIds();
		const specs = this.decls.map((decl): EngineDeviceSpec | EngineHousingSpec => {
			const base: EngineDeviceSpec = {
				key: decl.key,
				id: ids.get(decl.key)!,
				prefab: decl.prefab,
				...(decl.options.name !== undefined && { name: decl.options.name }),
				network: this.networkOf(decl, networks),
				props: decl.props,
				...(decl.options.custom && { custom: true }),
			};
			if (!decl.housing) return base;
			const pins: Record<string, number> = {};
			for (const [pin, target] of Object.entries(decl.housing.pins ?? {})) {
				if (!PIN.test(pin)) throw new Error(`sim: "${decl.key}": invalid pin "${pin}" (use d0–d5)`);
				if (target === undefined) continue;
				const id = ids.get(target);
				if (id === undefined) throw new Error(`sim: "${decl.key}" ${pin}: no device "${target}"`);
				pins[pin] = id;
			}
			return { ...base, code: programOf(decl.key, decl.housing, root), pins };
		});

		const housingSpecs = specs.filter((s): s is EngineHousingSpec => "code" in s);
		const engine = buildEngine({
			networks,
			housings: housingSpecs,
			devices: specs.filter((s) => !("code" in s)),
			seed: opts.seed ?? 1,
		});

		const entries: DeviceEntry[] = specs.map((s) => ({
			key: s.key,
			device: engine.devices.get(s.id)!,
			prefab: s.prefab,
			network: s.network,
		}));
		const keyOfId = new Map(specs.map((s) => [s.id, s.key]));
		const chips = housingSpecs.map((spec): ChipDecl => {
			const housing = this.decls.find((d) => d.key === spec.key)!.housing!;
			return {
				key: spec.key,
				id: spec.id,
				source: housing.file ?? "<code>",
				pins: Object.fromEntries(Object.entries(spec.pins).map(([pin, id]) => [pin, keyOfId.get(id)!])),
				...(housing.linesPerTick !== undefined && { linesPerTick: housing.linesPerTick }),
				...(housing.countNonInstructionLines !== undefined && {
					countNonInstructionLines: housing.countNonInstructionLines,
				}),
				...(housing.restartClearsState !== undefined && { restartClearsState: housing.restartClearsState }),
			};
		});
		return assembleWorld(engine, entries, chips, opts);
	}

	/** Explicit IDs first (checking for duplicates), then a fixed sequence for the rest. */
	private assignIds(): Map<string, number> {
		const ids = new Map<string, number>();
		const owner = new Map<number, string>();
		for (const decl of this.decls) {
			if (decl.options.id === undefined) continue;
			const id = parseId(decl.options.id);
			const other = owner.get(id);
			if (other !== undefined) throw new Error(`sim: "${decl.key}" and "${other}" have the same reference ID ${id}`);
			owner.set(id, decl.key);
			ids.set(decl.key, id);
		}
		let next = FIRST_AUTO_ID;
		for (const decl of this.decls) {
			if (ids.has(decl.key)) continue;
			while (owner.has(next)) next++;
			owner.set(next, decl.key);
			ids.set(decl.key, next++);
		}
		return ids;
	}

	private networkOf(decl: DeviceDecl, networks: string[]): string {
		const network = decl.options.network;
		if (network === undefined) {
			if (networks.length === 1) return networks[0]!;
			throw new Error(`sim: "${decl.key}": the world has several networks; say which with { network }`);
		}
		if (!networks.includes(network)) throw new Error(`sim: "${decl.key}": no network "${network}"`);
		return network;
	}
}

/** A chip for `assembleWorld`: its housing's key and ID, and per-chip settings. */
export interface ChipDecl {
	key: string;
	id: number;
	source: string;
	pins: Record<string, string>;
	linesPerTick?: number;
	countNonInstructionLines?: boolean;
	restartClearsState?: boolean;
}

/** @internal Wrap built emulator objects in a World with its scheduler. */
export function assembleWorld(engine: Engine, entries: DeviceEntry[], chipDecls: ChipDecl[], opts: SimOptions): World {
	const world = new World(entries, new EventQueue(), {
		tickSeconds: opts.tickSeconds ?? 0.5,
		maxTicks: opts.maxTicks ?? 10_000,
		maxLinesPerRun: opts.maxLinesPerRun ?? 1_000_000,
	});
	const chips = chipDecls.map(
		(chip) =>
			new ChipState(
				chip.key,
				engine.chips.get(chip.id)!,
				chip.source,
				chip.linesPerTick ?? opts.linesPerTick ?? 128,
				chip.countNonInstructionLines ?? opts.countNonInstructionLines ?? true,
				chip.pins,
				chip.restartClearsState ?? opts.restartClearsState ?? false,
			),
	);
	const gate = opts.debug === false ? undefined : (opts.debug ?? getDefaultDebugGate());
	const scheduler = new Scheduler(
		chips,
		{
			tickSeconds: world.options.tickSeconds,
			maxLinesPerRun: world.options.maxLinesPerRun,
			failOnHalt: opts.failOnHalt ?? false,
			traceLength: opts.traceLength ?? 50,
		},
		{
			world,
			...(gate && { gate }),
			beginTick: (tick) => world.beginTick(tick),
			endTick: (tick) => world.endTick(tick),
		},
	);
	world.attach(scheduler);
	return world;
}

function programOf(key: string, housing: HousingOptions, root: string): string {
	const { file, code } = housing;
	if ((file === undefined) === (code === undefined)) {
		throw new Error(`sim: housing "${key}" needs exactly one of { file } or { code }`);
	}
	return file !== undefined ? readScript(resolve(root, file)) : code!.replace(/\r\n/g, "\n");
}

/** Start declaring a world: `sim().device(…).housing(…).build()`. */
export function sim(options?: SimOptions): SimBuilder {
	return new SimBuilder(options);
}
