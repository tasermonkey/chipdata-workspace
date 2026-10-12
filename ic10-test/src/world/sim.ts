import { resolve } from "node:path";
import type { PrefabProps } from "../prefabs.ts";
import { modPrefabs } from "../catalog/mods.ts";
import { type DebugGate, getDefaultDebugGate } from "../debug/gate.ts";
import { buildEngine, type Engine, type EngineDeviceSpec, type EngineHousingSpec } from "../engine/build.ts";
import { hasDeviceData, isCatalogued } from "../engine/device.ts";
import { MIRROR_PREFAB } from "../engine/mirror.ts";
import { parseId, type ReferenceId } from "../engine/ids.ts";
import { ChipState, Scheduler } from "../scheduler/scheduler.ts";
import { readScript } from "../scripts.ts";
import {
	type AtmosphereEntry,
	type AttachOptions,
	type Attachments,
	applyReadings,
	deviceReadings,
	makePipe,
	makeRoom,
	type PipeInit,
	type Port,
	type RoomInit,
} from "./atmospheres.ts";
import { EventQueue } from "./events.ts";
import { type DeviceEntry, World } from "./world.ts";

/**
 * A prefab the device catalogue knows: the emulator's game data, or a mod's device in the project's
 * ic10-mods/ once `ic10-bench catalog` has written ic10-bench-env.d.ts (see prefabs.ts).
 */
export type KnownPrefab = keyof PrefabProps;

/** A known prefab's logic properties, read-only ones included (a test sets a sensor's readings). */
export type PropsOf<P extends KnownPrefab> = PrefabProps[P];

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

/** Where a device is, what it's called in game, and the pipes and room it's attached to. */
export interface DeviceOptions extends AttachOptions {
	/** Reference ID: a number or the game's `$hex` form. Default: the next one in a fixed sequence. */
	id?: ReferenceId;
	/** In-game name, for `lbn` / `sbn`. Default: the prefab name. */
	name?: string;
	/** Data network id. May be left out when the world has one network. */
	network?: string;
	/**
	 * The device is in neither the emulator's catalogue nor the project's `ic10-mods/` (a mod nobody
	 * has exported yet, say). Its PrefabHash is HASH(prefab), and it accepts every logic property,
	 * readable and writable. Devices only. Mods' devices in `ic10-mods/` don't need it.
	 */
	custom?: boolean;
}

/** A Logic Mirror: where it is, and the device on another network it stands in for. */
export interface MirrorOptions {
	/** Key of the device it stands in for. Left out: none chosen yet, so reads and writes halt the chip. */
	target?: string;
	/** Data network it's on, where chips see it. May be left out when the world has one network. */
	network?: string;
	/** Reference ID: a number or the game's `$hex` form. Default: the next one in a fixed sequence. */
	id?: ReferenceId;
	/** In-game name, for `lbn` / `sbn`. Default: the prefab name. */
	name?: string;
	/** Whether it has power. Default true. Unpowered, reads are 0 and writes are dropped. */
	powered?: boolean;
}

export type Pin = "d0" | "d1" | "d2" | "d3" | "d4" | "d5";

/** A chip housing and its program: exactly one of `file` or `code`. */
export interface HousingOptions<P extends KnownPrefab = "StructureCircuitHousing"> extends DeviceOptions {
	/** Path to an `.ic10` file, relative to `root`. */
	file?: string;
	/** Inline IC10 source. */
	code?: string;
	/** Which device (by key) is on each pin. */
	pins?: Partial<Record<Pin, string>>;
	/** Housing prefab. Default `StructureCircuitHousing`. */
	prefab?: P;
	/** The housing's own logic properties (`db`). */
	props?: PropsOf<P>;
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
	housing?: HousingOptions<KnownPrefab>;
	mirror?: MirrorOptions;
}

/** First automatic reference ID; later ones count up, skipping any given explicitly. */
const FIRST_AUTO_ID = 0x1001;
const PIN = /^d[0-5]$/;

/** Declares a world, then builds it. Start with `sim()`. */
export class SimBuilder {
	private readonly networks: string[] = [];
	private readonly decls: DeviceDecl[] = [];
	private readonly atmospheres: AtmosphereEntry[] = [];

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
	device<P extends KnownPrefab>(key: string, prefab: P, props?: PropsOf<P>, options?: DeviceOptions & { custom?: false }): this;
	/** A device in neither the emulator nor the project's ic10-mods/: `custom`, with any property names. */
	device(key: string, prefab: string, props: Record<string, number> | undefined, options: DeviceOptions & { custom: true }): this;
	device(key: string, prefab: string, props: Record<string, number> = {}, options: DeviceOptions = {}): this {
		this.decls.push({ key, prefab, props, options });
		return this;
	}

	/**
	 * Add a pipe network, by moles (`gases`) or by `pressure` and `ratios`. Devices attach to it with
	 * `{ pipe }` or `{ ports }`, and read it from then on.
	 */
	pipe(key: string, init: PipeInit): this {
		this.atmospheres.push(makePipe(key, init));
		return this;
	}

	/**
	 * Add a room. With a `volume`, a sealed room; without one, outside air too big to change, given
	 * by `temperature`, `pressure` and `ratios`. Devices attach to it with `{ room }`.
	 */
	room(key: string, init: RoomInit): this {
		this.atmospheres.push(makeRoom(key, init));
		return this;
	}

	/**
	 * Add a Logic Mirror (`StructureLogicMirror`): on its own network it stands in for `target`, a
	 * device on another, as in game. `l` / `s` (and `ld` / `sd` with the mirror's ID) read and write
	 * the target, `PrefabHash` and `ReferenceId` included; batch instructions see a Logic Mirror.
	 */
	mirror(key: string, options: MirrorOptions = {}): this {
		const { id, name, network } = options;
		this.decls.push({
			key,
			prefab: MIRROR_PREFAB,
			props: {},
			options: { ...(id !== undefined && { id }), ...(name !== undefined && { name }), ...(network !== undefined && { network }) },
			mirror: options,
		});
		return this;
	}

	/** Add a chip housing running a program, with devices on its pins. */
	housing<P extends KnownPrefab = "StructureCircuitHousing">(key: string, options: HousingOptions<P>): this {
		this.decls.push({
			key,
			prefab: options.prefab ?? "StructureCircuitHousing",
			props: (options.props ?? {}) as Record<string, number>,
			options,
			housing: options as HousingOptions<KnownPrefab>,
		});
		return this;
	}

	async build(): Promise<World> {
		const opts = this.options;
		const networks = this.networks.length > 0 ? this.networks : ["data"];
		const root = opts.root ?? process.cwd();

		const keys = new Set<string>();
		for (const { key } of this.atmospheres) {
			if (keys.has(key)) throw new Error(`sim: "${key}" is declared twice`);
			keys.add(key);
		}
		for (const decl of this.decls) {
			if (keys.has(decl.key)) throw new Error(`sim: "${decl.key}" is declared twice`);
			keys.add(decl.key);
			if (decl.mirror) continue;
			if (decl.housing && decl.options.custom) {
				throw new Error(`sim: housing "${decl.key}": a housing can't be custom`);
			}
			const known = hasDeviceData(decl.prefab) || modPrefabs().has(decl.prefab);
			if (decl.housing && !isCatalogued(decl.prefab)) {
				throw new Error(`sim: housing "${decl.key}": the emulator has no housing ${decl.prefab}`);
			}
			if (decl.options.custom && known) {
				throw new Error(`sim: "${decl.key}": ${decl.prefab} is a known device, so it can't be custom; drop { custom: true }`);
			}
			if (!decl.options.custom && !known) {
				throw new Error(
					`sim: "${decl.key}": no device ${decl.prefab} in the emulator or the project's ic10-mods/; for one neither knows, pass { custom: true }`,
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
				...(modPrefabs().has(decl.prefab) && { mod: modPrefabs().get(decl.prefab)! }),
				...(decl.mirror && { mirror: this.mirrorSpec(decl.key, decl.mirror, ids) }),
			};
			if (!decl.housing) return base;
			const pins: Record<string, number> = {};
			for (const [pin, target] of Object.entries(decl.housing.pins ?? {})) {
				if (!PIN.test(pin)) throw new Error(`sim: "${decl.key}": invalid pin "${pin}" (use d0–d5)`);
				if (target === undefined) continue;
				const id = ids.get(target);
				if (id === undefined) throw new Error(`sim: "${decl.key}" ${pin}: no device "${target}"`);
				// In game a pin can only be set to a device on the housing's own data network.
				const targetNetwork = this.networkOf(this.decls.find((d) => d.key === target)!, networks);
				if (targetNetwork !== base.network) {
					throw new Error(
						`sim: "${decl.key}" ${pin}: "${target}" is on network "${targetNetwork}", not "${base.network}"; a pin only reaches devices on the housing's network`,
					);
				}
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

		const entries: DeviceEntry[] = specs.map((s) => {
			const decl = this.decls.find((d) => d.key === s.key)!;
			const device = engine.devices.get(s.id)!;
			const attached = this.attachmentsOf(decl);
			if (!attached) return { key: s.key, device, prefab: s.prefab, network: s.network };
			const readings = deviceReadings(s.key, device, s.prefab, attached);
			for (const reading of readings) {
				if (Object.hasOwn(decl.props, reading.prop)) {
					throw new Error(
						`sim: "${s.key}": ${reading.prop} comes from ${reading.source.kind} "${reading.source.key}", so it can't be set on the device; set the ${reading.source.kind}'s gas instead`,
					);
				}
			}
			applyReadings(device, readings);
			return { key: s.key, device, prefab: s.prefab, network: s.network, attached, readings };
		});
		const keyOfId = new Map(specs.map((s) => [s.id, s.key]));
		const chips = housingSpecs.map((spec): ChipDecl => {
			const housing = this.decls.find((d) => d.key === spec.key)!.housing!;
			return {
				key: spec.key,
				id: spec.id,
				source: housing.file ?? "<code>",
				...(housing.file !== undefined && { path: resolve(root, housing.file) }),
				pins: Object.fromEntries(Object.entries(spec.pins).map(([pin, id]) => [pin, keyOfId.get(id)!])),
				...(housing.linesPerTick !== undefined && { linesPerTick: housing.linesPerTick }),
				...(housing.countNonInstructionLines !== undefined && {
					countNonInstructionLines: housing.countNonInstructionLines,
				}),
				...(housing.restartClearsState !== undefined && { restartClearsState: housing.restartClearsState }),
			};
		});
		return assembleWorld(engine, entries, chips, opts, this.atmospheres);
	}

	private mirrorSpec(key: string, mirror: MirrorOptions, ids: Map<string, number>): NonNullable<EngineDeviceSpec["mirror"]> {
		const powered = mirror.powered ?? true;
		if (mirror.target === undefined) return { powered };
		if (mirror.target === key) throw new Error(`sim: mirror "${key}" can't be its own target`);
		const target = ids.get(mirror.target);
		if (target === undefined) throw new Error(`sim: mirror "${key}" { target }: no device "${mirror.target}"`);
		return { target, powered };
	}

	/** The pipes and room a device is attached to, or undefined if none. */
	private attachmentsOf(decl: DeviceDecl): Attachments | undefined {
		const { pipe, room, ports = {} } = decl.options;
		if (pipe === undefined && room === undefined && Object.keys(ports).length === 0) return undefined;
		const find = (key: string, kind: AtmosphereEntry["kind"], option: string): AtmosphereEntry => {
			const entry = this.atmospheres.find((a) => a.key === key);
			if (!entry) throw new Error(`sim: "${decl.key}" { ${option} }: no ${kind} "${key}"`);
			if (entry.kind !== kind) throw new Error(`sim: "${decl.key}" { ${option} }: "${key}" is a ${entry.kind}, not a ${kind}`);
			return entry;
		};
		const attached: Attachments = { ports: {} };
		if (pipe !== undefined) attached.pipe = find(pipe, "pipe", "pipe");
		if (room !== undefined) attached.room = find(room, "room", "room");
		for (const [port, key] of Object.entries(ports) as [Port, string | undefined][]) {
			if (key === undefined) continue;
			if (!["input", "input2", "output", "output2"].includes(port)) {
				throw new Error(`sim: "${decl.key}": no port "${port}" (use input, input2, output, output2)`);
			}
			attached.ports[port] = find(key, "pipe", `ports.${port}`);
		}
		return attached;
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
	/** Absolute path of the program's file, for `file:` programs. */
	path?: string;
	pins: Record<string, string>;
	linesPerTick?: number;
	countNonInstructionLines?: boolean;
	restartClearsState?: boolean;
}

/** @internal Wrap built emulator objects in a World with its scheduler. */
export function assembleWorld(
	engine: Engine,
	entries: DeviceEntry[],
	chipDecls: ChipDecl[],
	opts: SimOptions,
	atmospheres: AtmosphereEntry[] = [],
): World {
	const world = new World(entries, new EventQueue(), atmospheres, {
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
				chip.path,
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
			describeWorld: () => world.describeAtmospheres(),
		},
	);
	world.attach(scheduler);
	return world;
}

function programOf(key: string, housing: HousingOptions<KnownPrefab>, root: string): string {
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
