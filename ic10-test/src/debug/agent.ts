import { resolve } from "node:path";
import type { Ic10Error } from "@stationeers-ic/ic10";
import { formatValue } from "../matchers/report.ts";
import type { ChipHandle, World } from "../world/world.ts";
import { evaluate, evaluateCondition, interpolate } from "./evaluate.ts";
import type { DebugGate, DebugLineInfo } from "./gate.ts";
import { Inspector } from "./inspect.ts";
import {
	type AdapterMessage,
	type AgentEvent,
	type AgentMessage,
	type BreakpointSpec,
	type FrameInfo,
	PROTOCOL_VERSION,
	type Requests,
	type StopReason,
	type ThreadInfo,
} from "./protocol.ts";

/** How the agent and the adapter exchange messages: a socket, or an in-memory pair in tests. */
export interface Transport {
	send(message: AgentMessage): void;
	onMessage(handler: (message: AdapterMessage) => void): void;
}

interface Thread {
	info: ThreadInfo;
	world: World;
	/** The last line it was let through to run, and its text, for telling calls and returns. */
	lastLine?: number;
	lastText?: string;
	/** The tick its last line ran in, for telling when a new turn starts. */
	lastTick?: number;
	/** The calls it's in, outermost first: its call stack. */
	calls: Call[];
	/** Restarts seen (a restart starts the program again, with no calls). */
	restarts: number;
	/**
	 * Set by a stop that comes after a line ran (a data breakpoint, an automatic yield), which shows
	 * the chip at its next line: carrying on runs that line without stopping at it again.
	 */
	resumeAt?: number;
}

/** A data breakpoint: a value on one chip of one world, and what it was when last looked at. */
interface Watch {
	world: number;
	chip: string;
	/** What `evaluate` reads, on that chip: `r15`, `d0.On`, `stack[3]`, `coolant.Temperature`. */
	expr: string;
	label: string;
	condition?: string;
	last?: number;
}

/** What `dataBreakpointInfo` hands out, and `setDataBreakpoints` gets back. */
interface DataId {
	world: number;
	chip: string;
	expr: string;
	label: string;
}

/**
 * One call a chip is in. IC10 has no call frames: the stack is the call stack, as in assembly. A
 * function that calls another does `push ra` … `pop ra` and leaves `sp` where it found it, so a
 * call has returned when the chip is back at the line after it, with `sp` back where it was (or
 * just after a `j ra`, for a function that leaves a result on the stack).
 */
interface Call {
	/** The `jal` (or branch-and-link) line. */
	from: number;
	/** Where it returns to: the line after it, which is what `ra` holds. */
	returnsTo: number;
	/** `sp` when the call was made. */
	sp: number;
	/** The line it jumped to (a label, usually). */
	target: number;
}

/** A step in progress, measured against the chip's call stack. */
interface Step {
	kind: "step";
	how: "in" | "over" | "out";
	thread: number;
	/** How many calls deep the chip was when the step started. */
	depth: number;
}

type Mode =
	| { kind: "run" }
	/** Stop at the next line of any chip (Pause, stop on entry, a step whose chip ended). */
	| { kind: "pause"; reason: StopReason }
	| Step
	/** Step Tick: stop at the chip's first instruction in a tick after `after`. */
	| { kind: "turn"; thread: number; after: number }
	/** Run N Ticks: stop once `world` has finished tick `until` - 1 (so `world.tick` is `until`). */
	| { kind: "ticks"; thread: number; world: World; until: number; ticks: number }
	/** Run Until Event: stop after an event of `world` fires (one with this label, if given). */
	| { kind: "event"; thread: number; world: World; label?: string };

/** Instructions that jump and set `ra`: `jal`, and the branch-and-link family (`beqal`, `bdseal`, …). */
const CALL = /^\s*(jal|b[a-z]*al)\s/;
const RETURN = /^\s*j\s+ra\s*(#.*)?$/;
const LABEL = /^\s*(\w+)\s*:/;
/** Calls deeper than this are dropped from the bottom (a script using `jal` as a jump never returns). */
const MAX_CALLS = 256;
/** How long the agent lets a run go before letting messages in (Pause, new breakpoints). */
const YIELD_MS = 8;

/**
 * The debugger's side in the test process. It's a `DebugGate`: the scheduler asks it before every
 * line, and it decides there whether to stop (a breakpoint, a step, Pause, a halt), so a run never
 * waits on the adapter except when stopped. While stopped it answers the adapter's requests.
 */
export class DebugAgent {
	readonly gate: DebugGate;
	private readonly transport: Transport;

	private configured = false;
	private readonly whenConfigured: Promise<void>;
	private markConfigured!: () => void;

	private mode: Mode = { kind: "run" };
	/** Set while stopped: lets the run go on. */
	private resume: (() => void) | null = null;

	private readonly inspector = new Inspector();
	private readonly breakpoints = new Map<string, Map<number, BreakpointSpec>>();
	private filters = { halt: true, autoYield: false };
	private watches: Watch[] = [];

	private readonly threads = new Map<number, Thread>();
	private readonly worlds = new Map<World, { number: number; threads: Map<string, number> }>();
	private nextThread = 1;

	private lastYield = performance.now();
	private calls = 0;

	constructor(transport: Transport) {
		this.transport = transport;
		this.whenConfigured = new Promise((done) => {
			this.markConfigured = done;
		});
		this.gate = {
			beforeLine: (info) => this.beforeLine(info),
			afterLine: (info) => this.afterLine(info),
			onHalt: (info) => this.onHalt(info),
			onAutoYield: (info) => this.onAutoYield(info),
			onTick: (info) => this.onTick(info),
			onEvent: (info) => this.onEvent(info),
		};
		transport.onMessage((message) => this.handle(message));
		this.event({ event: "hello", version: PROTOCOL_VERSION, pid: process.pid });
	}

	/** Resolves once the adapter has set its breakpoints and said the test may run. */
	get ready(): Promise<void> {
		return this.whenConfigured;
	}

	/** Tell the adapter the test process is done. */
	terminate(): void {
		this.event({ event: "terminated" });
	}

	/** The adapter has gone: stop nothing more, and let a stopped or waiting test run on. */
	detach(): void {
		this.breakpoints.clear();
		this.watches = [];
		this.filters = { halt: false, autoYield: false };
		if (!this.configured) {
			this.configured = true;
			this.markConfigured();
		}
		this.carryOn({ kind: "run" });
	}

	// --- the gate --------------------------------------------------------------------------------

	private beforeLine(info: DebugLineInfo): void | Promise<void> {
		if (!this.configured) return this.whenConfigured.then(() => this.beforeLine(info));
		const thread = this.thread(info.world, info.chip);
		const previous = { line: thread.lastLine, text: thread.lastText };
		thread.lastLine = info.line;
		thread.lastText = info.text;
		thread.lastTick = info.tick;
		const chip = info.world.chip(info.chip);
		const pastEnd = info.line >= chip.lineCount;
		const returned = trackCalls(thread, chip, info.line, previous);
		const resuming = thread.resumeAt === info.line;
		thread.resumeAt = undefined;

		// A watched value that changed since the last line: something outside the chips did it.
		const changed = this.changedWatch();
		if (changed) return this.stopForData(thread, changed, "between lines (a model, a pipe or room reading, or the test)");

		// Steps and Pause skip blank, comment and label lines: they run (and count toward the tick's
		// lines) without stopping.
		const step =
			this.mode.kind === "turn"
				? this.turnStop(thread, info.tick, pastEnd)
				: resuming
					? undefined
					: this.stepStop(thread, returned, pastEnd);
		if (step && chip.isInstruction(info.line)) return this.stop(thread, step);
		if (!pastEnd && !resuming) {
			const hit = this.breakpointAt(chip, info.line);
			if (hit) return this.stop(thread, "breakpoint");
		}
		return this.letMessagesIn();
	}

	private afterLine(info: DebugLineInfo): void | Promise<void> {
		const changed = this.changedWatch();
		if (!changed) return;
		const thread = this.thread(info.world, info.chip);
		thread.resumeAt = info.world.chip(info.chip).line;
		return this.stopForData(thread, changed, `by line ${info.line + 1} (${info.text.trim()})`);
	}

	private onHalt(info: DebugLineInfo & { error: Ic10Error }): void | Promise<void> {
		const thread = this.thread(info.world, info.chip);
		if (this.filters.halt) {
			return this.stop(thread, "halt", `Halted at line ${info.line + 1}: ${info.error.message}`);
		}
		const mode = this.mode;
		if ((mode.kind === "step" || mode.kind === "turn") && mode.thread === thread.info.id) {
			this.mode = { kind: "pause", reason: mode.kind === "turn" ? "tick" : "step" };
		}
	}

	private onTick(info: { world: World; tick: number }): void | Promise<void> {
		// With every chip asleep, no line looks: a model's change shows here.
		const changed = this.changedWatch();
		if (changed) return this.stopForData(this.watchThread(changed.watch), changed, `in tick ${info.tick - 1}, between lines (a model or a pipe or room reading)`);
		const mode = this.mode;
		if (mode.kind === "ticks" && mode.world === info.world && info.tick >= mode.until) {
			const ran = `Ran ${mode.ticks} ${mode.ticks === 1 ? "tick" : "ticks"}`;
			return this.stop(this.threadById(mode.thread), "tick", `${ran}: ${info.tick} done`);
		}
		// A world whose chips all sleep runs ticks with no lines: let Pause in here too.
		return this.letMessagesIn();
	}

	private onEvent(info: { world: World; tick: number; label: string }): void | Promise<void> {
		const changed = this.changedWatch();
		if (changed) return this.stopForData(this.watchThread(changed.watch), changed, `by the event "${info.label}" at the start of tick ${info.tick}`);
		const mode = this.mode;
		if (mode.kind !== "event" || mode.world !== info.world) return;
		if (mode.label !== undefined && mode.label !== info.label) return;
		return this.stop(this.threadById(mode.thread), "event", `Event "${info.label}" ran at the start of tick ${info.tick}`);
	}

	private onAutoYield(info: DebugLineInfo): void | Promise<void> {
		if (!this.filters.autoYield) return;
		const thread = this.thread(info.world, info.chip);
		const chip = info.world.chip(info.chip);
		thread.resumeAt = chip.line;
		return this.stop(thread, "autoYield", `Auto-yield: ${chip.linesPerTick} lines used in tick ${info.tick}, after line ${info.line + 1}`);
	}

	// --- data breakpoints ------------------------------------------------------------------------

	/**
	 * Look at every watched value; the first that changed (and whose condition holds) is returned.
	 * Every watch takes its new value as the one to compare with next time, so a change is reported
	 * once, where it's first seen.
	 */
	private changedWatch(): { watch: Watch; chip: ChipHandle; from: number; to: number } | undefined {
		let hit: { watch: Watch; chip: ChipHandle; from: number; to: number } | undefined;
		for (const watch of this.watches) {
			const chip = this.watchChip(watch);
			if (!chip) continue;
			const value = safely(() => evaluate(chip, watch.expr));
			if (value === undefined) continue;
			const before = watch.last;
			watch.last = value;
			if (hit || before === undefined || Object.is(before, value)) continue;
			if (watch.condition && !this.conditionHolds(chip, watch.condition, watch.label)) continue;
			hit = { watch, chip, from: before, to: value };
		}
		return hit;
	}

	private conditionHolds(chip: ChipHandle, condition: string, what: string): boolean {
		try {
			return evaluateCondition(chip, condition);
		} catch (error) {
			this.output("stderr", `data breakpoint on ${what}: ${messageOf(error)}\n`);
			return true; // a broken condition stops, so it gets noticed
		}
	}

	private stopForData(
		thread: Thread,
		{ watch, chip, from, to }: { watch: Watch; chip: ChipHandle; from: number; to: number },
		how: string,
	): Promise<void> {
		const show = (value: number) => formatValue(value, chip.world);
		return this.stop(thread, "data", `${watch.label}: ${show(from)} → ${show(to)}, ${how}`);
	}

	/** Take every watched value as it is now (after an edit while stopped, say). */
	private rebaseline(): void {
		for (const watch of this.watches) {
			const chip = this.watchChip(watch);
			watch.last = chip ? safely(() => evaluate(chip, watch.expr)) : undefined;
		}
	}

	/** A watch's chip, once its world has been seen. */
	private watchChip(watch: Watch): ChipHandle | undefined {
		for (const [world, entry] of this.worlds) {
			if (entry.number === watch.world) return safely(() => world.chip(watch.chip));
		}
		return undefined;
	}

	private watchThread(watch: Watch): Thread {
		for (const [, entry] of this.worlds) {
			const id = entry.number === watch.world ? entry.threads.get(watch.chip) : undefined;
			if (id !== undefined) return this.threadById(id);
		}
		throw new Error(`no chip ${watch.chip} in world ${watch.world}`);
	}

	private dataBreakpointInfo(args: Requests["dataBreakpointInfo"]["args"]): Requests["dataBreakpointInfo"]["result"] {
		let chip: ChipHandle;
		let expr: string;
		let label: string;
		if (args.ref) {
			const found = this.inspector.find(args.ref, args.name);
			chip = found.chip;
			if (found.node.evaluateName === undefined) return { dataId: null, description: `${args.name} can't be watched` };
			expr = found.node.evaluateName;
			// A register row's name shows its aliases: `r15 (Stage)`.
			label = found.node.name.startsWith(expr) ? found.node.name : expr;
		} else {
			const thread = args.thread !== undefined ? this.threadById(args.thread) : this.threads.values().next().value;
			if (!thread) return { dataId: null, description: "no chip has run yet" };
			chip = this.chipOf(thread);
			expr = args.name.trim();
			label = expr;
		}
		const define = chip.defines().find((d) => d.name === expr && d.kind !== "alias");
		if (define) return { dataId: null, description: `${expr} is a ${define.kind}, which never changes` };
		if (safely(() => evaluate(chip, expr)) === undefined) return { dataId: null, description: `${expr} isn't a value` };
		const thread = this.thread(chip.world, chip.key);
		const world = this.worlds.get(chip.world)!.number;
		const dataId: DataId = { world, chip: chip.key, expr, label: `${label} on ${thread.info.name}` };
		return { dataId: JSON.stringify(dataId), description: dataId.label };
	}

	private setDataBreakpoints(args: Requests["setDataBreakpoints"]["args"]): Requests["setDataBreakpoints"]["result"] {
		const results: { verified: boolean; message?: string }[] = [];
		const watches: Watch[] = [];
		for (const spec of args.breakpoints) {
			const id = parseDataId(spec.dataId);
			if (!id) {
				results.push({ verified: false, message: "not a data breakpoint this debugger made" });
				continue;
			}
			// Keep what an unchanged watch last saw, so setting another one doesn't lose a change.
			const old = this.watches.find((w) => w.world === id.world && w.chip === id.chip && w.expr === id.expr);
			watches.push({ ...id, ...(spec.condition && { condition: spec.condition }), ...(old?.last !== undefined && { last: old.last }) });
			results.push({ verified: true });
		}
		this.watches = watches;
		for (const watch of watches) {
			if (watch.last !== undefined) continue;
			const chip = this.watchChip(watch);
			if (chip) watch.last = safely(() => evaluate(chip, watch.expr));
		}
		return { breakpoints: results };
	}

	/** Whether the current step, Pause or stop-on-entry ends at this line. */
	private stepStop(thread: Thread, returned: boolean, pastEnd: boolean): StopReason | undefined {
		const mode = this.mode;
		if (mode.kind === "pause") return pastEnd ? undefined : mode.reason;
		if (mode.kind !== "step") return undefined;
		if (mode.thread !== thread.info.id) return undefined;
		if (pastEnd) {
			// The chip is running off the end of its program: there's no line to stop on, so stop
			// wherever the next chip is.
			this.mode = { kind: "pause", reason: "step" };
			return undefined;
		}
		// Step Over: back at (or above) the depth it started at, so a call it made has returned.
		// Step Out: one level up; at the top level there's nothing to be in, so after any `j ra`.
		const depth = thread.calls.length;
		const done =
			mode.how === "in" ||
			(mode.how === "over" && depth <= mode.depth) ||
			(mode.how === "out" && (depth < mode.depth || (mode.depth === 0 && returned)));
		if (!done) return undefined;
		// From here it's a single step, so if this line is a comment or label the next instruction stops.
		this.mode = { ...mode, how: "in" };
		return "step";
	}

	/** Whether a Step Tick ends at this line: the chip's first instruction in a later turn. */
	private turnStop(thread: Thread, tick: number, pastEnd: boolean): StopReason | undefined {
		const mode = this.mode;
		if (mode.kind !== "turn" || mode.thread !== thread.info.id) return undefined;
		if (pastEnd) {
			this.mode = { kind: "pause", reason: "tick" };
			return undefined;
		}
		if (tick <= mode.after) return undefined;
		// The turn has come; if this line is a comment or label, the chip's next instruction stops.
		this.mode = { ...mode, after: -1 };
		return "tick";
	}

	private breakpointAt(chip: ChipHandle, line: number): boolean {
		const path = chip.path;
		if (path === undefined) return false;
		const spec = this.breakpoints.get(pathKey(path))?.get(line);
		if (!spec) return false;
		if (spec.condition) {
			try {
				if (!evaluateCondition(chip, spec.condition)) return false;
			} catch (error) {
				this.output("stderr", `breakpoint at line ${line + 1}: ${messageOf(error)}\n`);
				return true; // a broken condition stops, so it gets noticed
			}
		}
		if (spec.logMessage !== undefined) {
			this.output("console", `${interpolate(chip, spec.logMessage)}\n`);
			return false;
		}
		return true;
	}

	private stop(thread: Thread, reason: StopReason, description?: string): Promise<void> {
		this.mode = { kind: "run" };
		this.event({ event: "stopped", reason, thread: thread.info.id, ...(description !== undefined && { description }) });
		return new Promise((done) => {
			this.resume = done;
		});
	}

	/** Every few milliseconds of running, wait a turn of the event loop so messages are read. */
	private letMessagesIn(): void | Promise<void> {
		if ((++this.calls & 0xff) !== 0) return;
		const now = performance.now();
		if (now - this.lastYield < YIELD_MS) return;
		this.lastYield = now;
		return new Promise((done) => setImmediate(done));
	}

	// --- threads ---------------------------------------------------------------------------------

	/** A chip's thread, registering its world's chips the first time the world is seen. */
	private thread(world: World, chip: string): Thread {
		let entry = this.worlds.get(world);
		if (!entry) {
			entry = { number: this.worlds.size + 1, threads: new Map() };
			this.worlds.set(world, entry);
			for (const handle of world.listChips()) {
				const id = this.nextThread++;
				const name = entry.number === 1 ? handle.key : `${handle.key} (world ${entry.number})`;
				const info: ThreadInfo = { id, name, chip: handle.key, world: entry.number };
				entry.threads.set(handle.key, id);
				this.threads.set(id, { info, world, calls: [], restarts: 0 });
				this.event({ event: "thread", reason: "started", thread: info });
			}
		}
		return this.threads.get(entry.threads.get(chip)!)!;
	}

	private threadById(id: number): Thread {
		const thread = this.threads.get(id);
		if (!thread) throw new Error(`no thread ${id}`);
		return thread;
	}

	/**
	 * A chip's call stack, innermost first: where it is now, in the function its last call went to,
	 * then each caller at its `jal`, down to the program's top level (named by the chip).
	 */
	private frames(thread: Thread): FrameInfo[] {
		const chip = this.chipOf(thread);
		const calls = thread.calls;
		const source = chip.path !== undefined ? { path: chip.path } : { sourceRef: thread.info.id };
		/** The function `depth` calls deep, and where it returns to. */
		const name = (depth: number): string => {
			if (depth === 0) return thread.info.name;
			const call = calls[depth - 1]!;
			const label = LABEL.exec(chip.lineText(call.target) ?? "")?.[1] ?? `line ${call.target + 1}`;
			return `${label} (returns to line ${call.returnsTo + 1})`;
		};
		const frame = (depth: number, line: number): FrameInfo => ({
			thread: thread.info.id,
			name: name(depth),
			line,
			text: chip.lineText(line) ?? "",
			...source,
		});
		const frames = [frame(calls.length, chip.line)];
		for (let depth = calls.length - 1; depth >= 0; depth--) frames.push(frame(depth, calls[depth]!.from));
		return frames;
	}

	// --- requests --------------------------------------------------------------------------------

	private handle(message: AdapterMessage): void {
		try {
			const result = this.respond(message);
			this.transport.send({ type: "response", seq: message.seq, ok: true, result });
		} catch (error) {
			this.transport.send({ type: "response", seq: message.seq, ok: false, error: messageOf(error) });
		}
	}

	private respond(message: AdapterMessage): Requests[typeof message.command]["result"] {
		switch (message.command) {
			case "setBreakpoints": {
				const { path, breakpoints } = message.args;
				this.breakpoints.set(pathKey(path), new Map(breakpoints.map((b) => [b.line, b])));
				return { breakpoints: breakpoints.map((b) => ({ line: b.line, verified: true })) };
			}
			case "setExceptionFilters":
				this.filters = { ...message.args };
				return {};
			case "dataBreakpointInfo":
				return this.dataBreakpointInfo(message.args);
			case "setDataBreakpoints":
				return this.setDataBreakpoints(message.args);
			case "configurationDone":
				if (message.args.stopOnEntry) this.mode = { kind: "pause", reason: "entry" };
				this.configured = true;
				this.markConfigured();
				return {};
			case "continue":
				this.carryOn({ kind: "run" });
				return {};
			case "pause":
				if (this.resume === null) this.mode = { kind: "pause", reason: "pause" };
				return {};
			case "next":
			case "stepIn":
			case "stepOut": {
				const thread = this.threadById(message.args.thread);
				const how = message.command === "next" ? "over" : message.command === "stepIn" ? "in" : "out";
				this.carryOn({ kind: "step", how, thread: thread.info.id, depth: thread.calls.length });
				return {};
			}
			case "stepTick": {
				const thread = this.threadById(message.args.thread);
				const chip = this.chipOf(thread);
				if (chip.halted || chip.ended) {
					throw new Error(`${thread.info.name} has ${chip.halted ? "halted" : "ended"}, so it has no next turn`);
				}
				// A chip that has already run in this tick waits for the next one; one yet to run, for its turn in this one.
				this.carryOn({ kind: "turn", thread: thread.info.id, after: thread.lastTick ?? -1 }, thread.info.id);
				return {};
			}
			case "runTicks": {
				const { ticks } = message.args;
				if (!(Number.isInteger(ticks) && ticks >= 1)) throw new Error(`run ticks: give a whole number of ticks, 1 or more (got ${ticks})`);
				const thread = this.threadById(message.args.thread);
				const world = thread.world;
				this.carryOn({ kind: "ticks", thread: thread.info.id, world, until: world.tick + ticks, ticks }, thread.info.id);
				return {};
			}
			case "runUntilEvent": {
				const thread = this.threadById(message.args.thread);
				const { label } = message.args;
				const mode: Mode = { kind: "event", thread: thread.info.id, world: thread.world, ...(label !== undefined && { label }) };
				this.carryOn(mode, thread.info.id);
				return {};
			}
			case "events":
				return { events: this.threadById(message.args.thread).world.listEvents() };
			case "threads":
				return { threads: [...this.threads.values()].map((t) => t.info) };
			case "stackTrace":
				return { frames: this.frames(this.threadById(message.args.thread)) };
			case "source": {
				const chip = this.chipOf(this.threadById(message.args.sourceRef));
				const lines = Array.from({ length: chip.lineCount }, (_, i) => chip.lineText(i) ?? "");
				return { content: lines.join("\n") };
			}
			case "scopes":
				return { scopes: this.inspector.scopes(this.chipOf(this.threadById(message.args.thread))) };
			case "variables":
				return { variables: this.inspector.variables(message.args.ref) };
			case "setVariable": {
				const { ref, name, value } = message.args;
				const row = this.inspector.setVariable(ref, name, value);
				return { value: row.value, ref: row.ref };
			}
			case "evaluate": {
				const { thread, expression, context } = message.args;
				const chosen = thread !== undefined ? this.threadById(thread) : this.threads.values().next().value;
				if (!chosen) throw new Error("no chip has run yet");
				const row = this.inspector.evaluate(this.chipOf(chosen), expression, context);
				return { value: row.value, ref: row.ref };
			}
		}
	}

	/**
	 * Leave the stop (if stopped) and run on in `mode`. With `announce` (a tick command's thread),
	 * say so first: VS Code doesn't know a custom request runs on, and the event goes out ahead of
	 * the response, so it can't arrive after the next stop.
	 */
	private carryOn(mode: Mode, announce?: number): void {
		this.mode = mode;
		this.inspector.reset();
		// A value edited while stopped isn't a change to stop for.
		if (this.resume) this.rebaseline();
		const resume = this.resume;
		this.resume = null;
		if (resume && announce !== undefined) this.event({ event: "continued", thread: announce });
		resume?.();
	}

	private chipOf(thread: Thread): ChipHandle {
		return thread.world.chip(thread.info.chip);
	}

	private event(event: AgentEvent): void {
		this.transport.send({ type: "event", ...event });
	}

	private output(category: "console" | "stderr", text: string): void {
		this.event({ event: "output", category, text });
	}
}

/**
 * Keep a chip's call stack up to date as it reaches `line`, from the line it ran before. A taken
 * `jal` or branch-and-link (one that didn't fall through to the next line) is a call; arriving at a
 * call's return line, right after a `j ra` or with `sp` back where it was, is its return (and any
 * calls inside it that never came back are dropped with it). Returns whether the line before was
 * a `j ra`.
 */
function trackCalls(
	thread: Thread,
	chip: ChipHandle,
	line: number,
	previous: { line?: number | undefined; text?: string | undefined },
): boolean {
	const calls = thread.calls;
	if (chip.restarts.length !== thread.restarts) {
		thread.restarts = chip.restarts.length;
		calls.length = 0;
		return false;
	}
	const { line: from, text } = previous;
	if (from === undefined || text === undefined) return false;
	if (CALL.test(text) && line !== from + 1) {
		calls.push({ from, returnsTo: from + 1, sp: chip.sp, target: line });
		if (calls.length > MAX_CALLS) calls.shift();
		return false;
	}
	const returned = RETURN.test(text);
	const sp = chip.sp;
	const back = calls.findLastIndex((call) => call.returnsTo === line && (returned || sp <= call.sp));
	if (back >= 0) calls.length = back;
	else if (returned) calls.pop(); // a `j ra` to somewhere else: still a return
	return returned;
}

/** Paths compare case-insensitively on Windows, as its file system does. */
function pathKey(path: string): string {
	const full = resolve(path);
	return process.platform === "win32" ? full.toLowerCase() : full;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseDataId(text: string): DataId | undefined {
	try {
		const id = JSON.parse(text) as Partial<DataId>;
		if (typeof id.world !== "number" || typeof id.chip !== "string" || typeof id.expr !== "string") return undefined;
		return { world: id.world, chip: id.chip, expr: id.expr, label: typeof id.label === "string" ? id.label : id.expr };
	} catch {
		return undefined;
	}
}

function safely<T>(get: () => T): T | undefined {
	try {
		return get();
	} catch {
		return undefined;
	}
}
