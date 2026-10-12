/**
 * The protocol between the VS Code adapter (in the extension) and the debug agent (in the test
 * process): newline-delimited JSON, one message per line. The adapter sends requests; the agent
 * answers each with a response and sends events of its own (stops, new threads, output).
 *
 * Line numbers are 0-based, like the harness's; the adapter converts them for VS Code. This file
 * has no imports, so the extension can bundle it on its own.
 */

/** Bumped when a message changes shape. The agent says its version first, in `hello`. */
export const PROTOCOL_VERSION = 3;

/** A chip, which VS Code shows as a thread. */
export interface ThreadInfo {
	id: number;
	/** The chip's key, with its world's number when a test has built several worlds. */
	name: string;
	chip: string;
	/** Which world it's in, numbered from 1 in the order the agent first saw them. */
	world: number;
}

/** Where a chip is: its one stack frame. */
export interface FrameInfo {
	thread: number;
	name: string;
	/** The line it runs next, or halted on (0-based). */
	line: number;
	/** Source text of that line. */
	text: string;
	/** The program's file, or undefined for inline code (then use `sourceRef`). */
	path?: string;
	/** For inline code: ask for the text with the `source` request. */
	sourceRef?: number;
}

export interface BreakpointSpec {
	/** 0-based. */
	line: number;
	/** Stop only when this holds, e.g. `Stage == 2` or `vent.On`. */
	condition?: string;
	/** Print this instead of stopping; `{expr}` parts are replaced by their values. */
	logMessage?: string;
}

export interface BreakpointResult {
	line: number;
	verified: boolean;
	message?: string;
}

/** A group in the Variables panel: Registers, Stack, Devices, Atmospheres, World, Defines. */
export interface ScopeInfo {
	name: string;
	/** Ask for its contents with `variables`. */
	ref: number;
}

/** One row in the Variables panel (or an evaluated expression). */
export interface VariableInfo {
	name: string;
	value: string;
	/** Non-zero when it has children: ask for them with `variables`. */
	ref: number;
	/** An expression `evaluate` understands that gives this value, e.g. `vent.On`, for Watch. */
	evaluateName?: string;
	/** Whether `setVariable` refuses it (a reading from a pipe, a define, an ID). */
	readOnly?: boolean;
}

/** A data breakpoint: stop when the value `dataId` names changes (and `condition` holds, if given). */
export interface DataBreakpointSpec {
	/** From `dataBreakpointInfo`; it stays good across runs of the same test. */
	dataId: string;
	condition?: string;
}

/** A scripted event still to come, for choosing one to run until. */
export interface EventInfo {
	kind: "at" | "every" | "when";
	label: string;
	/** The next tick it fires at the start of; undefined for a `when` (it fires on a condition). */
	nextTick?: number;
	/** Ticks between firings, for an `every`. */
	interval?: number;
}

/**
 * Why the agent stopped. `tick`: a Step Tick reached the chip's next turn, or Run N Ticks ran its
 * ticks. `event`: Run Until Event saw its event fire. `data`: a data breakpoint's value changed.
 */
export type StopReason = "entry" | "breakpoint" | "step" | "pause" | "halt" | "autoYield" | "tick" | "event" | "data";

/** Each request's arguments and result. */
export interface Requests {
	/** Replace the breakpoints in one file (by absolute path). */
	setBreakpoints: { args: { path: string; breakpoints: BreakpointSpec[] }; result: { breakpoints: BreakpointResult[] } };
	/**
	 * Whether a value can have a data breakpoint: the row `name` under `ref`, or (no `ref`) an
	 * expression on the chip of `thread`. `dataId` is null when it can't, with the reason.
	 */
	dataBreakpointInfo: {
		args: { thread?: number; ref?: number; name: string };
		result: { dataId: string | null; description: string };
	};
	/** Replace every data breakpoint. */
	setDataBreakpoints: {
		args: { breakpoints: DataBreakpointSpec[] };
		result: { breakpoints: { verified: boolean; message?: string }[] };
	};
	/** Which exception-like stops are on: halts (default on) and automatic yields (default off). */
	setExceptionFilters: { args: { halt: boolean; autoYield: boolean }; result: Record<string, never> };
	/** Breakpoints are set: the test may run. With `stopOnEntry`, stop before the first line. */
	configurationDone: { args: { stopOnEntry?: boolean }; result: Record<string, never> };
	continue: { args: Record<string, never>; result: Record<string, never> };
	pause: { args: Record<string, never>; result: Record<string, never> };
	/** Step Over: one line, or a whole `jal` call. */
	next: { args: { thread: number }; result: Record<string, never> };
	/** Step Into: one line. */
	stepIn: { args: { thread: number }; result: Record<string, never> };
	/** Step Out: run until the chip has executed `j ra`. */
	stepOut: { args: { thread: number }; result: Record<string, never> };
	/**
	 * Step Tick: run to the start of the chip's next turn (past its yield, sleep or automatic yield),
	 * other chips running as usual. Refused for a chip that has halted or ended.
	 */
	stepTick: { args: { thread: number }; result: Record<string, never> };
	/**
	 * Run until `ticks` more ticks of the chip's world have finished (the tick in progress counts as
	 * one), then stop between ticks.
	 */
	runTicks: { args: { thread: number; ticks: number }; result: Record<string, never> };
	/**
	 * Run until a scripted event of the chip's world fires (only one with this label, if given), then
	 * stop just after it, before the tick's models and chips run.
	 */
	runUntilEvent: { args: { thread: number; label?: string }; result: Record<string, never> };
	/** The scripted events still to come in the chip's world. */
	events: { args: { thread: number }; result: { events: EventInfo[] } };
	threads: { args: Record<string, never>; result: { threads: ThreadInfo[] } };
	stackTrace: { args: { thread: number }; result: { frames: FrameInfo[] } };
	/** The text of an inline program (a frame's `sourceRef`). */
	source: { args: { sourceRef: number }; result: { content: string } };
	/** A chip's scopes. Their refs (and every ref below them) last until the run carries on. */
	scopes: { args: { thread: number }; result: { scopes: ScopeInfo[] } };
	variables: { args: { ref: number }; result: { variables: VariableInfo[] } };
	/** Set the row `name` under `ref` to `value`, an expression evaluated on the chip (`5`, `$1488`, `Max`). */
	setVariable: { args: { ref: number; name: string; value: string }; result: { value: string; ref: number } };
	/**
	 * A value as a chip sees it (see `evaluate` in evaluate.ts). A device or pipe gives its rows as
	 * children. On a hover, a logic type's name gives its description.
	 */
	evaluate: {
		args: { thread?: number; expression: string; context?: "hover" | "watch" | "repl" | "clipboard" };
		result: { value: string; ref: number };
	};
}

export type Command = keyof Requests;

export type RequestMessage = {
	[K in Command]: { type: "request"; seq: number; command: K; args: Requests[K]["args"] };
}[Command];

export type ResponseMessage =
	| { type: "response"; seq: number; ok: true; result: unknown }
	| { type: "response"; seq: number; ok: false; error: string };

export type AgentEvent =
	| { event: "hello"; version: number; pid: number }
	| { event: "thread"; reason: "started"; thread: ThreadInfo }
	| { event: "stopped"; reason: StopReason; thread: number; description?: string; text?: string }
	/** A tick command let a stopped test run on (VS Code tracks Continue and the steps itself). */
	| { event: "continued"; thread: number }
	| { event: "output"; category: "console" | "stderr"; text: string }
	| { event: "terminated" };

export type EventMessage = { type: "event" } & AgentEvent;

/** What the adapter sends. */
export type AdapterMessage = RequestMessage;
/** What the agent sends. */
export type AgentMessage = ResponseMessage | EventMessage;
