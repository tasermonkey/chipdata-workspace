import { resolve } from "node:path";
import type { Ic10Error } from "@stationeers-ic/ic10";
import type { ChipHandle, World } from "../world/world.ts";
import { evaluateCondition, interpolate } from "./evaluate.ts";
import type { DebugGate, DebugLineInfo } from "./gate.ts";
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
	/** Text of the last line it was let through to run, for Step Out (`j ra`). */
	lastText?: string;
}

type Mode =
	| { kind: "run" }
	/** Stop at the next line of any chip (Pause, stop on entry, a step whose chip ended). */
	| { kind: "pause"; reason: StopReason }
	| { kind: "step"; how: "in" | "over" | "out"; thread: number; from: number; call: boolean };

/** Instructions that jump and set `ra`: `jal`, and the branch-and-link family (`beqal`, `bdseal`, …). */
const CALL = /^\s*(jal|b[a-z]*al)\s/;
const RETURN = /^\s*j\s+ra\s*(#.*)?$/;
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

	// --- the gate --------------------------------------------------------------------------------

	private beforeLine(info: DebugLineInfo): void | Promise<void> {
		if (!this.configured) return this.whenConfigured.then(() => this.beforeLine(info));
		const thread = this.thread(info.world, info.chip);
		const previous = thread.lastText;
		thread.lastText = info.text;
		const chip = info.world.chip(info.chip);
		const pastEnd = info.line >= chip.lineCount;

		// Steps and Pause skip blank, comment and label lines: they run (and count toward the tick's
		// lines) without stopping.
		const step = this.stepStop(thread, info, previous, pastEnd);
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
	private stepStop(thread: Thread, info: DebugLineInfo, previous: string | undefined, pastEnd: boolean): StopReason | undefined {
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
		const done =
			mode.how === "in" ||
			(mode.how === "over" && (!mode.call || info.line === mode.from + 1)) ||
			(mode.how === "out" && previous !== undefined && RETURN.test(previous));
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
				this.threads.set(id, { info, world });
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

	private frame(thread: Thread): FrameInfo {
		const chip = thread.world.chip(thread.info.chip);
		const line = chip.line;
		const text = chip.lineText(line) ?? "";
		return {
			thread: thread.info.id,
			name: thread.info.name,
			line,
			text,
			...(chip.path !== undefined ? { path: chip.path } : { sourceRef: thread.info.id }),
		};
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
				const chip = thread.world.chip(thread.info.chip);
				const how = message.command === "next" ? "over" : message.command === "stepIn" ? "in" : "out";
				const call = CALL.test(chip.lineText(chip.line) ?? "");
				this.carryOn({ kind: "step", how, thread: thread.info.id, from: chip.line, call });
				return {};
			}
			case "threads":
				return { threads: [...this.threads.values()].map((t) => t.info) };
			case "stackTrace":
				return { frames: [this.frame(this.threadById(message.args.thread))] };
			case "source": {
				const chip = this.chipOf(this.threadById(message.args.sourceRef));
				const lines = Array.from({ length: chip.lineCount }, (_, i) => chip.lineText(i) ?? "");
				return { content: lines.join("\n") };
			}
		}
	}

	/** Leave the stop (if stopped) and run on in `mode`. */
	private carryOn(mode: Mode): void {
		this.mode = mode;
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

/** Paths compare case-insensitively on Windows, as its file system does. */
function pathKey(path: string): string {
	const full = resolve(path);
	return process.platform === "win32" ? full.toLowerCase() : full;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
