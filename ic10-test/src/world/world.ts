import type { Device, Ic10Error } from "@tasermonkey/ic10";
import {
	clearSlot,
	listProps,
	putItem,
	readProp,
	readSlot,
	slotOccupied,
	writeProp,
	writeSlot,
} from "../engine/device.ts";
import { formatId } from "../engine/ids.ts";
import { LogicMirror } from "../engine/mirror.ts";
import type { EnvSchema } from "@tasermonkey/ic10";
import { describeChip, SimBudgetError, SimRunError } from "../scheduler/errors.ts";
import type { AutoYield, ChipState, Halt, Scheduler, TraceEntry } from "../scheduler/scheduler.ts";
import { secondsToTicks } from "../scheduler/time.ts";
import type { Cancel, EventOptions, EventQueue, Interval, ScheduledEvent, When, WorldEvent } from "./events.ts";
import { type DeviceModel, ModelList, type WorldModel } from "./models.ts";
import { type EnvWorldOptions, worldFromEnv } from "./from-env.ts";
import { type Change, diffSnapshots, Recording, type Snapshot } from "./snapshot.ts";
import type { ScriptDefine } from "../engine/chip.ts";
import type { Mixture, Reservoir } from "../atmos/mixture.ts";
import { GASES, type GasName, isGasName } from "../atmos/gases.ts";
import { type AtmosphereEntry, type Attachments, applyReadings, type Port, type Reading } from "./atmospheres.ts";

/** Settings a built world runs with (see `SimOptions` for what each means). */
export interface WorldOptions {
	tickSeconds: number;
	maxTicks: number;
	maxLinesPerRun: number;
}

/** Budget for a run call that has no fixed length. */
export interface RunBudget {
	/** Fail if the call runs this many ticks without finishing. Defaults to the world's `maxTicks`. */
	maxTicks?: number;
}

export interface DeviceEntry {
	key: string;
	device: Device;
	prefab: string;
	network: string;
	/** The pipes and room it's attached to. */
	attached?: Attachments;
	/** What it reads from them, refreshed every tick. */
	readings?: Reading[];
}

/** A device in the world (a housing too), found by its test-side key. */
export class DeviceHandle {
	/** The world the device is in. */
	readonly world: World;
	private readonly entry: DeviceEntry;

	constructor(world: World, entry: DeviceEntry) {
		this.world = world;
		this.entry = entry;
	}

	/** Test-side key, e.g. `"vent"`. */
	get key(): string {
		return this.entry.key;
	}

	/** Reference ID (what `ld` / `sd` use). */
	get id(): number {
		return this.entry.device.id;
	}

	/** Reference ID as the game shows it, e.g. `$1488`. */
	get idHex(): string {
		return formatId(this.id);
	}

	get prefab(): string {
		return this.entry.prefab;
	}

	/** In-game name (what `lbn` / `sbn` match). Defaults to the prefab name, as in game. */
	get name(): string {
		return this.entry.device.name.toString();
	}

	/** Id of the data network it's on. */
	get network(): string {
		return this.entry.network;
	}

	/** The emulator's device, for anything the handle doesn't cover. */
	get raw(): Device {
		return this.entry.device;
	}

	/** A logic property's value (0 when unset). Throws if the device has no such property. */
	get(prop: string): number {
		return readProp(this.entry.device, prop);
	}

	/**
	 * Set a logic property, read-only ones included, as the game does when it updates readings.
	 * Throws for a reading that comes from an attached pipe or room: change the gas there instead.
	 */
	set(prop: string, value: number): this {
		const reading = this.entry.readings?.find((r) => r.prop === prop);
		if (reading) {
			const { kind, key } = reading.source;
			throw new Error(
				`"${this.key}".${prop} comes from ${kind} "${key}", so it can't be set on the device; change world.${kind}("${key}") instead`,
			);
		}
		writeProp(this.entry.device, prop, value);
		return this;
	}

	/** The pipe it sits on (`{ pipe }`), or undefined. */
	get pipe(): Mixture | undefined {
		return this.entry.attached?.pipe?.atmosphere as Mixture | undefined;
	}

	/** The room it's in (`{ room }`), or undefined. */
	get room(): Mixture | Reservoir | undefined {
		return this.entry.attached?.room?.atmosphere;
	}

	/** The pipe on one of its ports (`{ ports }`), or undefined. */
	port(port: Port): Mixture | undefined {
		return this.entry.attached?.ports[port]?.atmosphere as Mixture | undefined;
	}

	/** Properties that come from its pipes and room, which `set` refuses. */
	get readings(): string[] {
		return (this.entry.readings ?? []).map((r) => r.prop);
	}

	/** @internal Update its readings from its pipes and room. */
	refreshReadings(): void {
		if (this.entry.readings) applyReadings(this.entry.device, this.entry.readings);
	}

	/** Add to a logic property. */
	add(prop: string, delta: number): this {
		return this.set(prop, this.get(prop) + delta);
	}

	/** The named properties' values, or every property with a value if no names are given. */
	props(...names: string[]): Record<string, number> {
		if (names.length === 0) return listProps(this.entry.device);
		return Object.fromEntries(names.map((name) => [name, this.get(name)]));
	}

	/**
	 * An entry in the device's own memory, which `put` / `get` on a pin write and read (a logic
	 * sorter's instructions, say). Throws if the device has no memory. For a housing's chip, use
	 * `world.chip(key).stackAt(i)`.
	 */
	stackAt(index: number): number {
		const memory = this.entry.device.hasMemory ? this.entry.device.memory : undefined;
		if (!memory) throw new Error(`${this.prefab} "${this.key}" has no memory`);
		return memory.get(index) ?? 0;
	}

	/** One of the device's slots, for `ls` / `ss`. Throws if the device has no such slot. */
	slot(index: number): SlotHandle {
		return new SlotHandle(this.entry.device, index);
	}
}

/**
 * A Logic Mirror (`sim().mirror()`). It has no logic values of its own to get or set: chips read
 * and write its target through it, so read the target's handle instead.
 */
export class MirrorHandle extends DeviceHandle {
	private get mirror(): LogicMirror {
		return this.raw as LogicMirror;
	}

	/** The device it stands in for, or undefined. */
	get target(): DeviceHandle | undefined {
		const target = this.mirror.target;
		return target && this.world.deviceById(target.id);
	}

	/** Point it at another device, by key, as a screwdriver does in game; undefined for none. */
	setTarget(key: string | undefined): this {
		this.mirror.target = key === undefined ? undefined : this.world.device(key).raw;
		return this;
	}

	get powered(): boolean {
		return this.mirror.powered;
	}

	/** Power it or cut its power. Unpowered, reads through it are 0 and writes are dropped. */
	setPowered(powered: boolean): this {
		this.mirror.powered = powered;
		return this;
	}

	override get(prop: string): number {
		throw new Error(this.ownValues(prop));
	}

	override set(prop: string, _value: number): this {
		throw new Error(this.ownValues(prop));
	}

	private ownValues(prop: string): string {
		const target = this.target;
		const instead = target ? `; use world.device("${target.key}").${prop}` : "";
		return `"${this.key}" is a Logic Mirror: it has no ${prop} of its own${instead}`;
	}
}

/** A device's slot, and the item in it. */
export class SlotHandle {
	private readonly device: Device;
	readonly index: number;

	constructor(device: Device, index: number) {
		slotOccupied(device, index); // throws if there's no such slot
		this.device = device;
		this.index = index;
	}

	/** Whether there's an item in the slot. */
	get occupied(): boolean {
		return slotOccupied(this.device, this.index);
	}

	/**
	 * Put an item (by prefab name) in the slot, replacing what's there. Sets `Occupied`, `OccupantHash`
	 * and `Quantity` (default 1) as the game does; `props` sets those and other slot values.
	 */
	put(item: string, props: Record<string, number> = {}): this {
		putItem(this.device, this.index, item, props);
		return this;
	}

	/** Empty the slot. Its values then read 0. */
	clear(): this {
		clearSlot(this.device, this.index);
		return this;
	}

	/** A slot value as `ls` reads it (0 for an empty slot). */
	get(prop: string): number {
		return readSlot(this.device, this.index, prop);
	}

	/** Set a value on the item in the slot. Throws if the slot is empty. */
	set(prop: string, value: number): this {
		writeSlot(this.device, this.index, prop, value);
		return this;
	}
}

/** A chip in its housing, found by the housing's test-side key. */
export class ChipHandle {
	/** The world the chip is in. */
	readonly world: World;
	private readonly state: ChipState;

	constructor(world: World, state: ChipState) {
		this.world = world;
		this.state = state;
	}

	get key(): string {
		return this.state.key;
	}

	/** Where the program came from: a file path as the test gave it, `<code>`, or `<env>`. */
	get source(): string {
		return this.state.source;
	}

	/** Absolute path of the program's file, or undefined for inline (`code:`) and env programs. */
	get path(): string | undefined {
		return this.state.path;
	}

	/** Which device (by key) is on each pin, e.g. `{ d0: "vent" }`. */
	get pins(): Readonly<Record<string, string>> {
		return this.state.pins;
	}

	/** The housing, i.e. the chip's `db`. */
	get db(): DeviceHandle {
		return this.world.device(this.state.key);
	}

	/** A register's value, by `r0`–`r17`, `sp`, `ra`, or an alias the script has defined. */
	reg(name: string): number {
		return this.state.engine.register(this.registerIndex(name));
	}

	/** Set a register, by name or alias. */
	setReg(name: string, value: number): this {
		this.state.engine.setRegister(this.registerIndex(name), value);
		return this;
	}

	/** Whether `name` is a register, or an alias the script has defined so far. */
	hasRegister(name: string): boolean {
		return this.state.engine.resolveRegister(name) !== undefined;
	}

	/** Every register by raw name (`r0`…). */
	registers(): Record<string, number> {
		const out: Record<string, number> = {};
		for (let i = 0; i < this.state.engine.registerCount; i++) out[`r${i}`] = this.state.engine.register(i);
		return out;
	}

	/** Aliases defined so far, by register name, e.g. `{ r15: ["Stage"] }`. */
	aliases(): Record<string, string[]> {
		const out: Record<string, string[]> = {};
		for (const [index, names] of this.state.engine.aliases()) out[`r${index}`] = names;
		return out;
	}

	get sp(): number {
		return this.state.engine.register(this.state.engine.stackPointerRegister);
	}

	get ra(): number {
		return this.state.engine.register(this.state.engine.returnAddressRegister);
	}

	/** The stack below `sp` (what has been pushed). */
	stack(): number[] {
		const size = Math.max(0, Math.floor(this.sp));
		return Array.from({ length: size }, (_, i) => this.state.engine.stackAt(i));
	}

	/** One stack entry, whatever `sp` is (what `get` / `put` address). */
	stackAt(index: number): number {
		return this.state.engine.stackAt(index);
	}

	/** How many entries the stack has (the game's chips have 512). */
	get stackLength(): number {
		return this.state.engine.stackLength;
	}

	/** Set one stack entry, whatever `sp` is. */
	setStackAt(index: number, value: number): this {
		this.state.engine.setStackAt(index, value);
		return this;
	}

	/** What the script has defined so far (defines, aliases and labels), built-in constants left out. */
	defines(): ScriptDefine[] {
		return this.state.engine.defines();
	}

	/** The line the chip runs next, or the line it halted on (0-based, like the game's `LineNumber`). */
	get line(): number {
		return this.state.halt?.line ?? this.state.engine.nextLine;
	}

	/** Source text of a line (default: `line`). */
	lineText(index: number = this.line): string | undefined {
		return this.state.engine.lineText(index);
	}

	/** Whether a line is an instruction, as opposed to a blank, comment or label line. */
	isInstruction(index: number): boolean {
		return this.state.engine.isInstruction(index);
	}

	/** Line index of a label, or undefined if the program has no such label. */
	findLabel(name: string): number | undefined {
		return this.state.engine.findLabel(name);
	}

	/** Number of source lines. */
	get lineCount(): number {
		return this.state.engine.lineCount;
	}

	/** Every error recorded on the chip, of any severity. */
	get errors(): Ic10Error[] {
		return this.state.engine.errors;
	}

	/** Why and where the chip halted, or null if it hasn't. */
	get halt(): Halt | null {
		return this.state.halt;
	}

	get halted(): boolean {
		return this.state.halt !== null;
	}

	/** Ran off the end of its program (without an error). */
	get ended(): boolean {
		return this.state.ended;
	}

	get sleeping(): boolean {
		return this.state.sleepUntil !== null;
	}

	/** Game time, in seconds, the chip sleeps until, or null if it isn't sleeping. */
	get sleepUntil(): number | null {
		return this.state.sleepUntil;
	}

	/** Lines it has used toward the tick in progress's limit (see `linesPerTick`). */
	get linesThisTick(): number {
		return this.state.linesThisTick;
	}

	/** Its housing was switched off (`On` = 0) when its turn last came, so it isn't running. */
	get switchedOff(): boolean {
		return this.state.switchedOff;
	}

	/** Ticks in which it restarted from line 0 because its housing was switched back on. */
	get restarts(): readonly number[] {
		return this.state.restartLog;
	}

	/** Times the chip used up its lines for a tick and was preempted. */
	get autoYields(): number {
		return this.state.autoYields;
	}

	/** Every automatic yield so far: the tick and the last line run before it. */
	get autoYieldLog(): readonly AutoYield[] {
		return this.state.autoYieldLog;
	}

	/** Lines executed in total. */
	get linesExecuted(): number {
		return this.state.linesExecuted;
	}

	/** Lines per tick before an automatic yield. */
	get linesPerTick(): number {
		return this.state.linesPerTick;
	}

	/** Where the chip is, in one line: halted, ended, sleeping or the line it runs next. */
	get status(): string {
		return describeChip(this.state, this.world.scheduler);
	}

	/** The last lines this chip ran (up to `n`, from what the world keeps; see `traceLength`). */
	recentLines(n = 20): TraceEntry[] {
		return this.world.scheduler.trace.filter((entry) => entry.chip === this.key).slice(-n);
	}

	/** Run whole ticks until this chip halts or ends. */
	runToHalt(budget?: RunBudget): Promise<void> {
		return this.world.runWhile(() => !this.state.stopped, "runToHalt", `"${this.key}" was still running`, budget);
	}

	/** @internal */
	registerIndex(name: string): number {
		const index = this.state.engine.resolveRegister(name);
		if (index === undefined) {
			const known = Object.values(this.aliases()).flat().join(", ");
			throw new Error(`"${this.key}" has no register or alias "${name}" (aliases so far: ${known || "none"})`);
		}
		return index;
	}
}

/** The devices on one data network. */
export class NetworkHandle {
	private readonly handles: DeviceHandle[];

	constructor(handles: DeviceHandle[]) {
		this.handles = handles;
	}

	devices(): DeviceHandle[] {
		return [...this.handles];
	}

	/** Devices with this in-game name. */
	byName(name: string): DeviceHandle[] {
		return this.handles.filter((d) => d.name === name);
	}

	/** Devices of this prefab. */
	byType(prefab: string): DeviceHandle[] {
		return this.handles.filter((d) => d.prefab === prefab);
	}
}

/**
 * A built world: devices on data networks, and chips run under the game's tick rules. Build one
 * with `sim()`.
 */
export class World {
	private readonly devices = new Map<string, DeviceHandle>();
	private readonly chips = new Map<string, ChipHandle>();
	private readonly recordings: Recording[] = [];
	private running = false;
	/** @internal Set by the builder once the scheduler exists. */
	scheduler!: Scheduler;

	private readonly events: EventQueue;
	readonly options: WorldOptions;

	/**
	 * Build a world from emulator env JSON: an object, JSON text, or a path to a `.json` file.
	 * Devices are keyed by their `name` when it's unique, otherwise by reference ID in `$hex` form.
	 */
	static fromEnv(env: EnvSchema | string, options?: EnvWorldOptions): Promise<World> {
		return worldFromEnv(env, options);
	}

	private readonly atmospheres = new Map<string, AtmosphereEntry>();
	private readonly models = new ModelList();

	constructor(devices: DeviceEntry[], events: EventQueue, atmospheres: AtmosphereEntry[], options: WorldOptions) {
		this.events = events;
		this.options = options;
		for (const entry of devices) {
			const handle = entry.device instanceof LogicMirror ? new MirrorHandle(this, entry) : new DeviceHandle(this, entry);
			this.devices.set(entry.key, handle);
		}
		for (const entry of atmospheres) this.atmospheres.set(entry.key, entry);
	}

	/** @internal */
	attach(scheduler: Scheduler): void {
		this.scheduler = scheduler;
		for (const state of scheduler.chips) this.chips.set(state.key, new ChipHandle(this, state));
	}

	/**
	 * @internal Scheduler hook: start of a tick. Scripted events run, then models, then devices
	 * update their readings from their pipes and rooms, so chips see this tick's atmosphere.
	 */
	async beginTick(tick: number): Promise<void> {
		const gate = this.scheduler.gate;
		await this.events.fire(tick, this, gate?.onEvent && ((label) => gate.onEvent!({ world: this, tick, label })));
		this.models.run(this.options.tickSeconds, this, tick);
		this.refreshReadings();
	}

	/**
	 * Update every attached device's readings from its pipes and rooms now. The world does this at
	 * the start of every tick; call it to see a change to a pipe on a device before the next tick.
	 */
	refreshReadings(): void {
		for (const device of this.devices.values()) device.refreshReadings();
	}

	/** @internal Scheduler hook: end of a tick. */
	async endTick(tick: number): Promise<void> {
		for (const recording of this.recordings) recording.sample(tick);
	}

	// --- accessors -------------------------------------------------------------------------------

	/** Ticks completed. */
	get tick(): number {
		return this.scheduler.tick;
	}

	/** Game time, in seconds, at the start of the tick in progress (or the next one). */
	get time(): number {
		return this.scheduler.time;
	}

	device(key: string): DeviceHandle {
		const handle = this.devices.get(key);
		if (!handle) throw new Error(`no device "${key}" (devices: ${[...this.devices.keys()].join(", ")})`);
		return handle;
	}

	/** A Logic Mirror, by key. */
	mirror(key: string): MirrorHandle {
		const handle = this.device(key);
		if (!(handle instanceof MirrorHandle)) throw new Error(`"${key}" is a ${handle.prefab}, not a Logic Mirror`);
		return handle;
	}

	chip(key: string): ChipHandle {
		const handle = this.chips.get(key);
		if (!handle) throw new Error(`no chip "${key}" (chips: ${[...this.chips.keys()].join(", ")})`);
		return handle;
	}

	/** Every device, housings included, in declaration order. */
	listDevices(): DeviceHandle[] {
		return [...this.devices.values()];
	}

	/** Every chip, in the order they run. */
	listChips(): ChipHandle[] {
		return [...this.chips.values()];
	}

	/** The device with this reference ID, or undefined. */
	deviceById(id: number): DeviceHandle | undefined {
		return this.listDevices().find((d) => d.id === id);
	}

	/** A pipe network, by key. */
	pipe(key: string): Mixture {
		return this.atmosphereEntry(key, "pipe").atmosphere as Mixture;
	}

	/** A room, by key: a `Mixture` for a sealed room, a `Reservoir` for outside air. */
	room(key: string): Mixture | Reservoir {
		return this.atmosphereEntry(key, "room").atmosphere;
	}

	/** A pipe or room, by key. */
	atmosphere(key: string): Mixture | Reservoir {
		const entry = this.atmospheres.get(key);
		if (!entry) throw new Error(`no pipe or room "${key}" (pipes and rooms: ${[...this.atmospheres.keys()].join(", ") || "none"})`);
		return entry.atmosphere;
	}

	/** Report lines for the pipes and rooms: `pipes and rooms:` then one line each. None if there are none. */
	describeAtmospheres(): string[] {
		if (this.atmospheres.size === 0) return [];
		const width = Math.max(...[...this.atmospheres.keys()].map((k) => k.length), 4);
		const lines = [...this.atmospheres.values()].map((entry) => {
			const values = atmosphereValues(entry);
			const gases = Object.entries(values)
				.filter(([name]) => name.startsWith("Ratio"))
				.map(([name, ratio]) => `${name.slice(5)} ${(ratio * 100).toFixed(1)}%`);
			const moles = values.TotalMoles === undefined ? "" : ` ${round(values.TotalMoles)} mol,`;
			const kind = entry.atmosphere.volume === Infinity ? "outside" : `${entry.kind} ${round(entry.atmosphere.volume)} L`;
			return `  ${entry.key.padEnd(width)}  ${kind}: ${round(values.Pressure!)} kPa, ${round(values.Temperature!)} K,${moles} ${gases.join(", ") || "empty"}`;
		});
		return ["pipes and rooms:", ...lines];
	}

	/** Every pipe and room, in declaration order. */
	listAtmospheres(): readonly AtmosphereEntry[] {
		return [...this.atmospheres.values()];
	}

	/** A chip's housing, i.e. its `db`. */
	db(key: string): DeviceHandle {
		return this.chip(key).db;
	}

	network(id: string): NetworkHandle {
		const handles = [...this.devices.values()].filter((d) => d.network === id);
		if (handles.length === 0) throw new Error(`no devices on network "${id}"`);
		return new NetworkHandle(handles);
	}

	/**
	 * A value by path: `vent.On` (a device property), `ic.Stage` or `ic.r15` (a chip register or
	 * alias; anything else on a chip key is its housing's property, e.g. `ic.Setting`), or
	 * `coolant.Temperature` (a pipe or room: `Pressure`, `Temperature`, `TotalMoles`, `Volume`,
	 * `Ratio<Gas>`, or a gas's moles by name, e.g. `coolant.Nitrogen`).
	 */
	value(path: string): number {
		const { key, name } = splitPath(path);
		const atmosphere = this.atmospheres.get(key);
		if (atmosphere) return atmosphereValue(atmosphere, name);
		const chip = this.chips.get(key);
		if (chip?.hasRegister(name)) return chip.reg(name);
		return this.device(key).get(name);
	}

	/** A path as snapshots spell it: a register alias becomes its register (`ic.Stage` → `ic.r15`). */
	canonicalPath(path: string): string {
		const { key, name } = splitPath(path);
		const chip = this.chips.get(key);
		if (chip?.hasRegister(name)) return `${key}.r${chip.registerIndex(name)}`;
		return path;
	}

	// --- running ---------------------------------------------------------------------------------

	/**
	 * Execute `n` lines of one chip, ignoring ticks: `yield` and `sleep` don't stop it and no game
	 * time passes. Stops early if the chip halts or ends. The chip may be left out when there's only one.
	 */
	step(n = 1, chip?: string): Promise<void> {
		return this.guard(async () => {
			const state = this.pickChip(chip, "step");
			for (let i = 0; i < n && !state.stopped; i++) await this.scheduler.stepChip(state, false);
		});
	}

	/** Run `n` ticks of game time. */
	runTicks(n: number): Promise<void> {
		return this.guard(async () => {
			if (!(Number.isInteger(n) && n >= 0)) throw new Error(`runTicks: invalid number of ticks: ${n}`);
			const target = this.scheduler.tick + n;
			while (this.scheduler.tick < target) await this.scheduler.advance();
		});
	}

	/** Run `seconds` of game time (rounded up to whole ticks). */
	runSeconds(seconds: number): Promise<void> {
		return this.runTicks(secondsToTicks(seconds, this.options.tickSeconds));
	}

	/**
	 * Run whole ticks until `condition` holds. It's checked before starting and after every tick.
	 * Fails with a trace if `maxTicks` pass first, or if nothing can change any more.
	 */
	runUntil(condition: (world: World) => boolean | Promise<boolean>, budget?: RunBudget): Promise<void> {
		return this.guard(async () => {
			const maxTicks = budget?.maxTicks ?? this.options.maxTicks;
			if (await condition(this)) return;
			let ticks = 0;
			for (;;) {
				if ((await this.scheduler.advance()) !== "tick") continue;
				if (await condition(this)) return;
				if (++ticks >= maxTicks) {
					throw new SimBudgetError(`runUntil: the condition was still false after ${maxTicks} ticks (maxTicks)`, this.scheduler);
				}
				if (this.idle()) {
					throw new SimRunError(
						"runUntil: the condition is false and can't change: every chip has stopped and no events are due",
						this.scheduler,
					);
				}
			}
		});
	}

	/**
	 * Run until a chip is about to execute a line (an index, or a label), and stop there, possibly in
	 * the middle of a tick. If the chip is already there, it runs until it comes back.
	 */
	runUntilLine(target: number | string, options?: RunBudget & { chip?: string }): Promise<void> {
		return this.guard(async () => {
			const state = this.pickChip(options?.chip, "runUntilLine");
			const line = this.resolveLine(state, target);
			const maxTicks = options?.maxTicks ?? this.options.maxTicks;
			const start = state.linesExecuted;
			let ticks = 0;
			for (;;) {
				if (state.stopped) {
					throw new SimRunError(`runUntilLine: "${state.key}" stopped before reaching line ${line}`, this.scheduler);
				}
				const result = await this.scheduler.advance(
					(chip, next) => chip === state && next === line && state.linesExecuted > start,
				);
				if (result === "stopped") return;
				if (result === "tick" && ++ticks >= maxTicks) {
					throw new SimBudgetError(
						`runUntilLine: "${state.key}" didn't reach line ${line} within ${maxTicks} ticks (maxTicks)`,
						this.scheduler,
					);
				}
			}
		});
	}

	/** Run whole ticks until every chip has halted or ended. For one-shot scripts. */
	runToHalt(budget?: RunBudget): Promise<void> {
		return this.runWhile(
			() => this.scheduler.chips.some((c) => !c.stopped),
			"runToHalt",
			"some chips were still running",
			budget,
		);
	}

	/** @internal Run whole ticks while `running()` holds. */
	runWhile(running: () => boolean, name: string, stillRunning: string, budget?: RunBudget): Promise<void> {
		return this.guard(async () => {
			const maxTicks = budget?.maxTicks ?? this.options.maxTicks;
			let ticks = 0;
			while (running()) {
				if ((await this.scheduler.advance()) === "tick" && ++ticks >= maxTicks && running()) {
					throw new SimBudgetError(`${name}: ${stillRunning} after ${maxTicks} ticks (maxTicks)`, this.scheduler);
				}
			}
			while (this.scheduler.tickInProgress) await this.scheduler.advance();
		});
	}

	// --- scripted events -------------------------------------------------------------------------

	/** Run `event` once, at the start of a tick (before any chip runs in it). */
	at(when: When, event: WorldEvent, options?: EventOptions): Cancel {
		const tick = "tick" in when ? when.tick : secondsToTicks(when.seconds, this.options.tickSeconds);
		if (tick < this.nextTickToStart()) throw new Error(`at: tick ${tick} has already started (world is at tick ${this.tick})`);
		return this.events.at(tick, event, options);
	}

	/** Run `event` every interval, starting one interval from now (or at `start`). */
	every(interval: Interval, event: WorldEvent, options?: EventOptions & { start?: When }): Cancel {
		const ticks = "ticks" in interval ? interval.ticks : secondsToTicks(interval.seconds, this.options.tickSeconds);
		const start = options?.start;
		const first =
			start === undefined
				? this.nextTickToStart() + ticks
				: "tick" in start
					? start.tick
					: secondsToTicks(start.seconds, this.options.tickSeconds);
		return this.events.every(ticks, first, event, options);
	}

	/** Run `event` whenever `condition` becomes true (checked at the start of each tick). */
	when(condition: (world: World) => boolean | Promise<boolean>, event: WorldEvent, options?: EventOptions): Cancel {
		return this.events.when(condition, event, options);
	}

	/** Scripted events still to come, in the order they were added (every `when`, since it may yet fire). */
	listEvents(): ScheduledEvent[] {
		return this.events.list(this.nextTickToStart());
	}

	// --- models ----------------------------------------------------------------------------------

	/**
	 * Give a device behaviour: `run(device, dt, world)` runs at the start of every tick, after
	 * scripted events and before chips, so what a script sets in one tick acts in the next.
	 */
	model(device: string, run: DeviceModel): Cancel;
	/** Add world behaviour that isn't one device's: `run(dt, world)` every tick, as above. */
	model(run: WorldModel): Cancel;
	model(target: string | WorldModel, run?: DeviceModel): Cancel {
		if (typeof target === "function") return this.models.add("world", target);
		const handle = this.device(target);
		if (!run) throw new Error(`model: no model given for "${target}"`);
		return this.models.add(`"${target}"`, (dt, world) => run(handle, dt, world));
	}

	/** What each model is for, in the order they run: a device's key, or "world" for a world model. */
	listModels(): string[] {
		return this.models.labels().map((label) => label.replace(/^"(.*)"$/, "$1"));
	}

	// --- snapshots and history -------------------------------------------------------------------

	/** Every device property and chip register now. */
	snapshot(): Snapshot {
		const values: Record<string, number> = {};
		for (const [key, device] of this.devices) {
			for (const [prop, value] of Object.entries(device.props())) values[`${key}.${prop}`] = value;
		}
		for (const [key, chip] of this.chips) {
			for (const [reg, value] of Object.entries(chip.registers())) values[`${key}.${reg}`] = value;
		}
		for (const [key, entry] of this.atmospheres) {
			for (const [name, value] of Object.entries(atmosphereValues(entry))) values[`${key}.${name}`] = value;
		}
		return { tick: this.tick, values };
	}

	/** What changed since `before` (or between two snapshots). */
	diff(before: Snapshot, after: Snapshot = this.snapshot()): Change[] {
		return diffSnapshots(before, after);
	}

	/** Record a value now and at the end of every tick from here on: a path (see `value`) or a function. */
	record(what: string | ((world: World) => number)): Recording {
		const recording =
			typeof what === "string"
				? new Recording(what, () => this.value(what))
				: new Recording("<fn>", () => what(this));
		recording.sample(this.tick);
		this.recordings.push(recording);
		return recording;
	}

	// --- helpers ---------------------------------------------------------------------------------

	private atmosphereEntry(key: string, kind: AtmosphereEntry["kind"]): AtmosphereEntry {
		const entry = this.atmospheres.get(key);
		if (entry?.kind === kind) return entry;
		const all = [...this.atmospheres.values()].filter((a) => a.kind === kind).map((a) => a.key);
		const other = entry ? ` ("${key}" is a ${entry.kind})` : "";
		throw new Error(`no ${kind} "${key}"${other} (${kind}s: ${all.join(", ") || "none"})`);
	}

	private nextTickToStart(): number {
		return this.scheduler.tickInProgress ? this.scheduler.tick + 1 : this.scheduler.tick;
	}

	/** Nothing can change any more: every chip has stopped, no events are due and there are no models. */
	idle(): boolean {
		return (
			this.scheduler.chips.every((c) => c.stopped) && !this.events.pending(this.scheduler.tick) && this.models.size === 0
		);
	}

	private pickChip(key: string | undefined, call: string): ChipState {
		const chips = this.scheduler.chips;
		if (key === undefined) {
			if (chips.length === 1) return chips[0]!;
			throw new Error(`${call}: the world has ${chips.length} chips; say which one`);
		}
		const state = chips.find((c) => c.key === key);
		if (!state) throw new Error(`${call}: no chip "${key}"`);
		return state;
	}

	private resolveLine(state: ChipState, target: number | string): number {
		if (typeof target === "number") {
			if (Number.isInteger(target) && target >= 0 && target < state.engine.lineCount) return target;
			throw new Error(`"${state.key}" has no line ${target} (it has ${state.engine.lineCount})`);
		}
		const line = state.engine.findLabel(target);
		if (line === undefined) throw new Error(`"${state.key}" has no label "${target}"`);
		return line;
	}

	/** One run call at a time, each with its own line budget. */
	private async guard(run: () => Promise<void>): Promise<void> {
		if (this.running) throw new Error("a run is already in progress (missing await?)");
		this.running = true;
		this.scheduler.linesThisRun = 0;
		try {
			await run();
		} finally {
			this.running = false;
		}
	}
}

/**
 * A pipe's or room's values as snapshots and reports show them: pressure, temperature, moles (not
 * for outside air, which has no end) and the ratio of each gas present.
 */
export function atmosphereValues(entry: AtmosphereEntry): Record<string, number> {
	const atmos = entry.atmosphere;
	const out: Record<string, number> = { Pressure: atmos.pressure, Temperature: atmos.temperature };
	if (Number.isFinite(atmos.totalMoles)) out.TotalMoles = atmos.totalMoles;
	for (const gas of GASES) {
		const ratio = atmos.ratio(gas.name);
		if (ratio > 0) out[`Ratio${gas.name}`] = ratio;
	}
	return out;
}

/** A number to 4 significant figures, for reports. */
function round(value: number): string {
	return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : String(value);
}

function atmosphereValue(entry: AtmosphereEntry, name: string): number {
	const atmos = entry.atmosphere;
	switch (name) {
		case "Pressure":
			return atmos.pressure;
		case "Temperature":
			return atmos.temperature;
		case "TotalMoles":
			return atmos.totalMoles;
		case "Volume":
			return atmos.volume;
	}
	if (name.startsWith("Ratio") && isGasName(name.slice(5))) return atmos.ratio(name.slice(5) as GasName);
	if (isGasName(name)) return atmos.moles(name);
	throw new Error(
		`${entry.kind} "${entry.key}" has no value "${name}" (use Pressure, Temperature, TotalMoles, Volume, Ratio<Gas>, or a gas's name for its moles)`,
	);
}

function splitPath(path: string): { key: string; name: string } {
	const dot = path.lastIndexOf(".");
	if (dot <= 0) throw new Error(`invalid path "${path}": use "<key>.<property or register>"`);
	return { key: path.slice(0, dot), name: path.slice(dot + 1) };
}
