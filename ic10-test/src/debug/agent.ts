import { resolve } from "node:path";
import type { Ic10Error } from "@stationeers-ic/ic10";
import type { ChipHandle, World } from "../world/world.ts";
import { evaluateCondition, interpolate } from "./evaluate.ts";
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
	/** The calls it's in, outermost first: its call stack. */
	calls: Call[];
	/** Restarts seen (a restart starts the program again, with no calls). */
	restarts: number;
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
	| Step;

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
			onHalt: (info) => this.onHalt(info),
			onAutoYield: (info) => this.onAutoYield(info),
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
		const chip = info.world.chip(info.chip);
		const pastEnd = info.line >= chip.lineCount;
		const returned = trackCalls(thread, chip, info.line, previous);

		// Steps and Pause skip blank, comment and label lines: they run (and count toward the tick's
		// lines) without stopping.
		const step = this.stepStop(thread, returned, pastEnd);
		if (step && chip.isInstruction(info.line)) return this.stop(thread, step);
		if (!pastEnd) {
			const hit = this.breakpointAt(chip, info.line);
			if (hit) return this.stop(thread, "breakpoint");
		}
		return this.letMessagesIn();
	}

	private onHalt(info: DebugLineInfo & { error: Ic10Error }): void | Promise<void> {
		const thread = this.thread(info.world, info.chip);
		if (this.filters.halt) {
			return this.stop(thread, "halt", `Halted at line ${info.line + 1}: ${info.error.message}`);
		}
		if (this.mode.kind === "step" && this.mode.thread === thread.info.id) this.mode = { kind: "pause", reason: "step" };
	}

	private onAutoYield(info: DebugLineInfo): void | Promise<void> {
		if (!this.filters.autoYield) return;
		const thread = this.thread(info.world, info.chip);
		const chip = info.world.chip(info.chip);
		return this.stop(thread, "autoYield", `Auto-yield: ${chip.linesPerTick} lines used in tick ${info.tick}, after line ${info.line + 1}`);
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

	/** Leave the stop (if stopped) and run on in `mode`. */
	private carryOn(mode: Mode): void {
		this.mode = mode;
		this.inspector.reset();
		const resume = this.resume;
		this.resume = null;
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
