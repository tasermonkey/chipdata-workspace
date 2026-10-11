/**
 * The debug adapter: VS Code speaks the Debug Adapter Protocol to it, and it runs one test under
 * Vitest with IC10_DEBUG set, so the test's debug agent connects back (see
 * `@tasermonkey/ic10-test/debug-protocol`). It holds no IC10 state of its own: breakpoints are
 * forwarded, and stops, threads and variables come from the agent.
 *
 * Nothing here imports `vscode`, so tests can drive it with a DAP client and no editor.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import {
	type AdapterMessage,
	type AgentEvent,
	type AgentMessage,
	type BreakpointSpec,
	type Command,
	PROTOCOL_VERSION,
	type Requests,
	type StopReason,
} from "@tasermonkey/ic10-test/debug-protocol";
import {
	DebugSession,
	ExitedEvent,
	InitializedEvent,
	OutputEvent,
	Scope,
	Source,
	StackFrame,
	StoppedEvent,
	TerminatedEvent,
	Thread,
	ThreadEvent,
} from "@vscode/debugadapter";
import type { DebugProtocol } from "@vscode/debugprotocol";

/** What a launch configuration of type `ic10-test` gives. */
export interface Ic10LaunchArgs extends DebugProtocol.LaunchRequestArguments {
	/** The test file. */
	test: string;
	/** The 1-based line of an `it` (or `describe`) to run alone; the whole file if left out. */
	line?: number;
	/** Where to run Vitest: the folder with its config. Default: the nearest one above the test. */
	cwd?: string;
	/** Stop before the first line any chip runs. */
	stopOnEntry?: boolean;
	/** The Node.js to run Vitest with. Default `node` (from PATH). */
	runtimeExecutable?: string;
	/** More arguments for `vitest run`. */
	args?: string[];
	env?: Record<string, string>;
}

/** The command that runs the test. */
export interface LaunchSpec {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
}

/** A running test process. */
export interface Launched {
	/** Resolves with the exit code when it ends. */
	exited: Promise<number | null>;
	kill(): void;
}

/**
 * Starts the test process. The default spawns it and passes its output on; the extension can start
 * it under the Node debugger instead, to debug the TypeScript too.
 */
export type Launcher = (spec: LaunchSpec, output: (category: "stdout" | "stderr", text: string) => void) => Launched;

export const spawnLauncher: Launcher = (spec, output) => {
	const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, windowsHide: true });
	child.stdout.setEncoding("utf8").on("data", (text: string) => output("stdout", text));
	child.stderr.setEncoding("utf8").on("data", (text: string) => output("stderr", text));
	const exited = new Promise<number | null>((done) => {
		child.on("exit", (code) => done(code));
		child.on("error", (error) => {
			output("stderr", `can't start ${spec.command}: ${error.message}\n`);
			done(null);
		});
	});
	return { exited, kill: () => child.kill() };
};

const STOP_REASONS: Record<StopReason, string> = {
	entry: "entry",
	breakpoint: "breakpoint",
	step: "step",
	pause: "pause",
	halt: "exception",
	autoYield: "exception",
};

const CONFIG_FILES = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs"];

export class Ic10TestSession extends DebugSession {
	private readonly launcher: Launcher;
	private server: Server | undefined;
	private launched: Launched | undefined;
	/** Set once the agent has said hello. */
	private agent: AgentLink | undefined;
	private connected = false;

	private readonly breakpoints = new Map<string, BreakpointSpec[]>();
	private filters = { halt: true, autoYield: false };
	private configured = false;
	private stopOnEntry = false;
	private ended = false;

	constructor(launcher: Launcher = spawnLauncher) {
		super();
		this.launcher = launcher;
		// The agent counts lines from 0; VS Code from 1.
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
		response.body = {
			supportsConfigurationDoneRequest: true,
			supportsConditionalBreakpoints: true,
			supportsLogPoints: true,
			supportsSetVariable: true,
			supportsEvaluateForHovers: true,
			supportsTerminateRequest: true,
			exceptionBreakpointFilters: [
				{ filter: "halt", label: "Halts", description: "Stop when a chip halts on an error", default: true },
				{
					filter: "autoYield",
					label: "Automatic yields",
					description: "Stop when a chip uses up its 128 lines in a tick",
					default: false,
				},
			],
		};
		this.sendResponse(response);
		this.sendEvent(new InitializedEvent());
	}

	protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: Ic10LaunchArgs): Promise<void> {
		try {
			const test = resolve(args.test);
			if (!existsSync(test)) throw new Error(`no test file ${test}`);
			const cwd = args.cwd ? resolve(args.cwd) : findVitestRoot(dirname(test));
			const vitest = findVitest(cwd);
			this.stopOnEntry = args.stopOnEntry ?? false;

			const port = await this.listen();
			const spec: LaunchSpec = {
				command: args.runtimeExecutable ?? "node",
				args: [vitest, "run", args.line ? `${test}:${args.line}` : test, "--testTimeout=0", ...(args.args ?? [])],
				cwd,
				env: { ...process.env, ...args.env, IC10_DEBUG: String(port) },
			};
			this.launched = this.launcher(spec, (category, text) => this.sendEvent(new OutputEvent(text, category)));
			void this.launched.exited.then((code) => this.end(code));
			this.sendResponse(response);
		} catch (error) {
			this.fail(response, error);
		}
	}

	protected override setBreakPointsRequest(
		response: DebugProtocol.SetBreakpointsResponse,
		args: DebugProtocol.SetBreakpointsArguments,
	): void {
		const path = args.source.path;
		const requested = args.breakpoints ?? [];
		if (path === undefined) {
			// Inline programs have no file to set breakpoints in.
			response.body = { breakpoints: requested.map(() => ({ verified: false, message: "breakpoints need a file" })) };
			return this.sendResponse(response);
		}
		const specs: BreakpointSpec[] = requested.map((b) => ({
			line: this.convertClientLineToDebugger(b.line),
			...(b.condition && { condition: b.condition }),
			...(b.logMessage && { logMessage: b.logMessage }),
		}));
		const file = this.convertClientPathToDebugger(path);
		this.breakpoints.set(file, specs);
		this.agent?.tell("setBreakpoints", { path: file, breakpoints: specs });
		response.body = {
			breakpoints: specs.map((b) => ({ verified: true, line: this.convertDebuggerLineToClient(b.line) })),
		};
		this.sendResponse(response);
	}

	protected override setExceptionBreakPointsRequest(
		response: DebugProtocol.SetExceptionBreakpointsResponse,
		args: DebugProtocol.SetExceptionBreakpointsArguments,
	): void {
		this.filters = { halt: args.filters.includes("halt"), autoYield: args.filters.includes("autoYield") };
		this.agent?.tell("setExceptionFilters", this.filters);
		this.sendResponse(response);
	}

	protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
		this.configured = true;
		this.agent?.tell("configurationDone", { stopOnEntry: this.stopOnEntry });
		this.sendResponse(response);
	}

	protected override async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
		const threads = this.agent ? (await this.agent.request("threads", {})).threads : [];
		response.body = { threads: threads.map((t) => new Thread(t.id, t.name)) };
		this.sendResponse(response);
	}

	protected override async stackTraceRequest(
		response: DebugProtocol.StackTraceResponse,
		args: DebugProtocol.StackTraceArguments,
	): Promise<void> {
		await this.forward(response, "stackTrace", { thread: args.threadId }, ({ frames }) => {
			response.body = {
				stackFrames: frames.map((f) => {
					const source = f.path
						? new Source(basename(f.path), this.convertDebuggerPathToClient(f.path))
						: new Source(`${f.name} (inline code)`, undefined, f.sourceRef);
					const name = f.text.trim() || "(end of program)";
					return new StackFrame(f.thread, name, source, this.convertDebuggerLineToClient(f.line), 1);
				}),
				totalFrames: frames.length,
			};
		});
	}

	protected override async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): Promise<void> {
		await this.forward(response, "source", { sourceRef: args.sourceReference }, ({ content }) => {
			response.body = { content, mimeType: "text/x-ic10" };
		});
	}

	protected override async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): Promise<void> {
		// A frame's id is its chip's thread id: each chip has one frame.
		await this.forward(response, "scopes", { thread: args.frameId }, ({ scopes }) => {
			response.body = { scopes: scopes.map((s) => new Scope(s.name, s.ref, false)) };
		});
	}

	protected override async variablesRequest(
		response: DebugProtocol.VariablesResponse,
		args: DebugProtocol.VariablesArguments,
	): Promise<void> {
		await this.forward(response, "variables", { ref: args.variablesReference }, ({ variables }) => {
			response.body = {
				variables: variables.map((v) => ({
					name: v.name,
					value: v.value,
					variablesReference: v.ref,
					...(v.evaluateName !== undefined && { evaluateName: v.evaluateName }),
					...(v.readOnly && { presentationHint: { attributes: ["readOnly"] } }),
				})),
			};
		});
	}

	protected override async setVariableRequest(
		response: DebugProtocol.SetVariableResponse,
		args: DebugProtocol.SetVariableArguments,
	): Promise<void> {
		const request = { ref: args.variablesReference, name: args.name, value: args.value };
		await this.forward(response, "setVariable", request, ({ value, ref }) => {
			response.body = { value, variablesReference: ref };
		});
	}

	protected override async evaluateRequest(
		response: DebugProtocol.EvaluateResponse,
		args: DebugProtocol.EvaluateArguments,
	): Promise<void> {
		const context: Requests["evaluate"]["args"]["context"] =
			args.context === "hover" || args.context === "watch" || args.context === "clipboard" ? args.context : "repl";
		const request = { expression: args.expression, context, ...(args.frameId !== undefined && { thread: args.frameId }) };
		await this.forward(response, "evaluate", request, ({ value, ref }) => {
			response.body = { result: value, variablesReference: ref };
		});
	}

	protected override async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
		await this.forward(response, "continue", {}, () => {
			response.body = { allThreadsContinued: true };
		});
	}

	protected override async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
		await this.forward(response, "next", { thread: args.threadId }, () => {});
	}

	protected override async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
		await this.forward(response, "stepIn", { thread: args.threadId }, () => {});
	}

	protected override async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
		await this.forward(response, "stepOut", { thread: args.threadId }, () => {});
	}

	protected override async pauseRequest(response: DebugProtocol.PauseResponse): Promise<void> {
		await this.forward(response, "pause", {}, () => {});
	}

	protected override terminateRequest(response: DebugProtocol.TerminateResponse): void {
		this.launched?.kill();
		this.sendResponse(response);
	}

	protected override disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
		this.launched?.kill();
		this.server?.close();
		this.sendResponse(response);
	}

	// --- the agent's side ------------------------------------------------------------------------

	/** Listen for the test's agent on a free local port. */
	private listen(): Promise<number> {
		const server = createServer((socket) => this.accept(socket));
		this.server = server;
		return new Promise((done, fail) => {
			server.once("error", fail);
			server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port));
		});
	}

	private accept(socket: Socket): void {
		if (this.connected) {
			// Vitest runs each test file in its own context; this session follows the first.
			this.sendEvent(new OutputEvent("ic10-test: another test file connected; it runs without stopping\n", "console"));
			socket.destroy();
			return;
		}
		this.connected = true;
		const link: AgentLink = new AgentLink(socket, (event) => this.onAgentEvent(link, event));
	}

	private onAgentEvent(link: AgentLink, event: AgentEvent): void {
		switch (event.event) {
			case "hello":
				if (event.version !== PROTOCOL_VERSION) {
					this.sendEvent(
						new OutputEvent(
							`ic10-test: the test's debug agent speaks protocol ${event.version}, this extension ${PROTOCOL_VERSION}; update one of them\n`,
							"stderr",
						),
					);
					this.launched?.kill();
					return;
				}
				// From here on requests go straight to the agent; first it gets what was set so far.
				this.agent = link;
				this.sync(link);
				return;
			case "thread":
				this.sendEvent(new ThreadEvent("started", event.thread.id));
				return;
			case "stopped": {
				const stopped = new StoppedEvent(STOP_REASONS[event.reason], event.thread, event.description) as DebugProtocol.StoppedEvent;
				stopped.body.allThreadsStopped = true;
				if (event.description !== undefined) stopped.body.description = event.description;
				this.sendEvent(stopped);
				return;
			}
			case "output":
				this.sendEvent(new OutputEvent(event.text, event.category));
				return;
			case "terminated":
				return; // the process ending says that
		}
	}

	/**
	 * Give a newly connected agent the breakpoints and filters set so far, then (if VS Code is done
	 * configuring) let it run. The requests go out in order, so configurationDone comes last.
	 */
	private sync(agent: AgentLink): void {
		for (const [path, breakpoints] of this.breakpoints) agent.tell("setBreakpoints", { path, breakpoints });
		agent.tell("setExceptionFilters", this.filters);
		if (this.configured) agent.tell("configurationDone", { stopOnEntry: this.stopOnEntry });
	}

	private async forward<K extends Command>(
		response: DebugProtocol.Response,
		command: K,
		args: Requests[K]["args"],
		fill: (result: Requests[K]["result"]) => void,
	): Promise<void> {
		try {
			if (!this.agent) throw new Error("the test hasn't reached its chips yet");
			fill(await this.agent.request(command, args));
			this.sendResponse(response);
		} catch (error) {
			this.fail(response, error);
		}
	}

	private fail(response: DebugProtocol.Response, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.sendErrorResponse(response, { id: 1, format: message, showUser: response.command === "launch" });
	}

	private end(code: number | null): void {
		if (this.ended) return;
		this.ended = true;
		this.server?.close();
		this.sendEvent(new ExitedEvent(code ?? 1));
		this.sendEvent(new TerminatedEvent());
	}
}

/** The protocol's client end: requests out, responses and events in. */
class AgentLink {
	private readonly socket: Socket;
	private seq = 1;
	private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

	constructor(socket: Socket, onEvent: (event: AgentEvent) => void) {
		this.socket = socket;
		socket.setNoDelay(true);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line) continue;
				const message = JSON.parse(line) as AgentMessage;
				if (message.type === "event") {
					onEvent(message);
					continue;
				}
				const pending = this.pending.get(message.seq);
				this.pending.delete(message.seq);
				if (message.ok) pending?.resolve(message.result);
				else pending?.reject(new Error(message.error));
			}
		});
		socket.on("close", () => {
			for (const { reject } of this.pending.values()) reject(new Error("the test process has gone"));
			this.pending.clear();
		});
		socket.on("error", () => {});
	}

	/** Send a request whose answer doesn't matter (if the process has gone, neither does it). */
	tell<K extends Command>(command: K, args: Requests[K]["args"]): void {
		this.request(command, args).catch(() => {});
	}

	request<K extends Command>(command: K, args: Requests[K]["args"]): Promise<Requests[K]["result"]> {
		const seq = this.seq++;
		return new Promise((resolve, reject) => {
			if (this.socket.destroyed) return reject(new Error("the test process has gone"));
			this.pending.set(seq, { resolve: resolve as (result: unknown) => void, reject });
			const message = { type: "request", seq, command, args } as AdapterMessage;
			this.socket.write(`${JSON.stringify(message)}\n`);
		});
	}
}

/** The nearest folder at or above `start` with a Vitest config (or failing that, a package.json). */
export function findVitestRoot(start: string): string {
	let fallback: string | undefined;
	for (let dir = start; ; dir = dirname(dir)) {
		if (CONFIG_FILES.some((f) => existsSync(join(dir, f)))) return dir;
		if (!fallback && existsSync(join(dir, "package.json"))) fallback = dir;
		if (dirname(dir) === dir) return fallback ?? start;
	}
}

/** Vitest's command-line script, as installed for `cwd`. */
export function findVitest(cwd: string): string {
	try {
		const pkg = createRequire(join(cwd, "noop.js")).resolve("vitest/package.json");
		return join(dirname(pkg), "vitest.mjs");
	} catch {
		throw new Error(`Vitest isn't installed for ${cwd} (npm install -D vitest)`);
	}
}
