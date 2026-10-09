import type { Device, Ic10Error } from "@stationeers-ic/ic10";
import { listProps, readProp, writeProp } from "../engine/device.ts";
import { formatId } from "../engine/ids.ts";
import type { EnvSchema } from "@stationeers-ic/ic10";
import { describeChip, SimBudgetError, SimRunError } from "../scheduler/errors.ts";
import type { AutoYield, ChipState, Halt, Scheduler, TraceEntry } from "../scheduler/scheduler.ts";
import { secondsToTicks } from "../scheduler/time.ts";
import type { Cancel, EventQueue, Interval, When, WorldEvent } from "./events.ts";
import { type EnvWorldOptions, worldFromEnv } from "./from-env.ts";
import { type Change, diffSnapshots, Recording, type Snapshot } from "./snapshot.ts";

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

	/** Set a logic property, read-only ones included, as the game does when it updates readings. */
	set(prop: string, value: number): this {
		writeProp(this.entry.device, prop, value);
		return this;
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

	/** Where the program came from: a file path, or `<code>`. */
	get source(): string {
		return this.state.source;
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

	/** The line the chip runs next, or the line it halted on (0-based, like the game's `LineNumber`). */
	get line(): number {
		return this.state.halt?.line ?? this.state.engine.nextLine;
	}

	/** Source text of a line (default: `line`). */
	lineText(index: number = this.line): string | undefined {
		return this.state.engine.lineText(index);
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

	constructor(devices: DeviceEntry[], events: EventQueue, options: WorldOptions) {
		this.events = events;
		this.options = options;
		for (const entry of devices) this.devices.set(entry.key, new DeviceHandle(this, entry));
	}

	/** @internal */
	attach(scheduler: Scheduler): void {
		this.scheduler = scheduler;
		for (const state of scheduler.chips) this.chips.set(state.key, new ChipHandle(this, state));
	}

	/** @internal Scheduler hook: start of a tick. */
	async beginTick(tick: number): Promise<void> {
		await this.events.fire(tick, this);
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
	 * alias; anything else on a chip key is its housing's property, e.g. `ic.Setting`).
	 */
	value(path: string): number {
		const { key, name } = splitPath(path);
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
	at(when: When, event: WorldEvent): Cancel {
		const tick = "tick" in when ? when.tick : secondsToTicks(when.seconds, this.options.tickSeconds);
		if (tick < this.nextTickToStart()) throw new Error(`at: tick ${tick} has already started (world is at tick ${this.tick})`);
		return this.events.at(tick, event);
	}

	/** Run `event` every interval, starting one interval from now (or at `start`). */
	every(interval: Interval, event: WorldEvent, options?: { start?: When }): Cancel {
		const ticks = "ticks" in interval ? interval.ticks : secondsToTicks(interval.seconds, this.options.tickSeconds);
		const start = options?.start;
		const first =
			start === undefined
				? this.nextTickToStart() + ticks
				: "tick" in start
					? start.tick
					: secondsToTicks(start.seconds, this.options.tickSeconds);
		return this.events.every(ticks, first, event);
	}

	/** Run `event` whenever `condition` becomes true (checked at the start of each tick). */
	when(condition: (world: World) => boolean | Promise<boolean>, event: WorldEvent): Cancel {
		return this.events.when(condition, event);
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

	private nextTickToStart(): number {
		return this.scheduler.tickInProgress ? this.scheduler.tick + 1 : this.scheduler.tick;
	}

	private idle(): boolean {
		return this.scheduler.chips.every((c) => c.stopped) && !this.events.pending(this.scheduler.tick);
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

function splitPath(path: string): { key: string; name: string } {
	const dot = path.lastIndexOf(".");
	if (dot <= 0) throw new Error(`invalid path "${path}": use "<key>.<property or register>"`);
	return { key: path.slice(0, dot), name: path.slice(dot + 1) };
}
