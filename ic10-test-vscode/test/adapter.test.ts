import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { DebugClient } from "@vscode/debugadapter-testsupport";
import type { DebugProtocol } from "@vscode/debugprotocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findVitestRoot,
	type Ic10LaunchArgs,
	Ic10TestSession,
	type Launcher,
	type LaunchSpec,
	spawnLauncher,
} from "../src/adapter.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TESTS = join(FIXTURES, "chips.debug.ts");
const COUNTER = join(FIXTURES, "counter.ic10");

/** Line (1-based) of the `it` with this name, as the CodeLens will give it. */
function itLine(name: string): number {
	return readFileSync(TESTS, "utf8").split("\n").findIndex((l) => l.includes(`it("${name}"`)) + 1;
}

function launchArgs(name: string, extra: Partial<Ic10LaunchArgs> = {}): Ic10LaunchArgs {
	return { test: TESTS, line: itLine(name), ...extra };
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Everything the adapter printed (Vitest's output among it), for failure messages and checks. */
function collectOutput(dc: DebugClient): () => string {
	let text = "";
	dc.on("output", (e: DebugProtocol.OutputEvent) => (text += e.body.output));
	return () => text;
}

describe("debug adapter", () => {
	let server: Server;
	let dc: DebugClient;
	/** How the next session starts the test; a test can swap it before launching. */
	let launcher: Launcher;

	beforeEach(async () => {
		launcher = spawnLauncher;
		// The adapter runs in this process, as it will inside VS Code; the client talks to it over a socket.
		server = createServer((socket) => {
			// The session is made when the client connects, before a test can swap the launcher.
			const session = new Ic10TestSession((spec, output) => launcher(spec, output));
			session.setRunAsServer(true);
			session.start(socket, socket);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		dc = new DebugClient("node", "unused", "ic10-test");
		dc.defaultTimeout = 30_000;
		await dc.start((server.address() as { port: number }).port);
	});

	afterEach(async () => {
		await dc.stop();
		server.close();
	});

	it("stops at a breakpoint in the .ic10 file, steps, shows and edits variables, and ends with the test", async () => {
		const output = collectOutput(dc);
		await dc.hitBreakpoint(launchArgs("counts once a tick"), { path: COUNTER, line: 3 });

		const { threads } = (await dc.threadsRequest()).body;
		expect(threads).toEqual([{ id: 1, name: "ic" }]);
		const frame = (await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames[0]!;
		expect(frame).toMatchObject({ id: 1000, name: "ic", line: 3, source: { path: COUNTER, name: "counter.ic10" } });

		const scopes = (await dc.scopesRequest({ frameId: frame.id })).body.scopes;
		expect(scopes.map((s) => s.name)).toEqual(["Registers", "Stack", "Devices", "World", "Defines"]);
		const registers = (await dc.variablesRequest({ variablesReference: scopes[0]!.variablesReference })).body.variables;
		expect(registers[0]).toMatchObject({ name: "r0 (Count)", value: "0", evaluateName: "r0" });

		const stepped = dc.waitForEvent("stopped");
		await dc.nextRequest({ threadId: 1 });
		expect((await stepped).body).toMatchObject({ reason: "step", threadId: 1, allThreadsStopped: true });
		expect((await dc.evaluateRequest({ expression: "Count", frameId: frame.id, context: "hover" })).body.result).toBe("1");

		const refs = (await dc.scopesRequest({ frameId: frame.id })).body.scopes[0]!.variablesReference;
		const set = await dc.setVariableRequest({ variablesReference: refs, name: "r0 (Count)", value: "1" });
		expect(set.body.value).toBe("1");

		await dc.setBreakpointsRequest({ source: { path: COUNTER }, breakpoints: [] });
		const exited = dc.waitForEvent("exited");
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		expect((await exited).body.exitCode, output()).toBe(0);
		await terminated;
		expect(output()).toMatch(/1 passed \| \d+ skipped/); // only the test at that line ran
	}, 60_000);

	it("shows the call stack, a frame for each call, and steps by it", async () => {
		const CALLS = join(FIXTURES, "calls.ic10");
		const lines = readFileSync(CALLS, "utf8").split("\n");
		const lineOf = (text: string) => lines.findIndex((l) => l.startsWith(text)) + 1;
		await dc.hitBreakpoint(launchArgs("makes nested and recursive calls"), { path: CALLS, line: lineOf("add Result Result 10") });

		const frames = (await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames;
		expect(frames.map((f) => [f.name, f.line])).toEqual([
			[`inner (returns to line ${lineOf("add Result Result 1")})`, lineOf("add Result Result 10")],
			[`outer (returns to line ${lineOf("yield")})`, lineOf("jal inner")],
			["ic", lineOf("jal outer")],
		]);
		expect(new Set(frames.map((f) => f.id)).size).toBe(3);
		// Each frame shows the chip's registers: IC10 has no locals.
		const scopes = (await dc.scopesRequest({ frameId: frames[2]!.id })).body.scopes;
		expect(scopes[0]!.name).toBe("Registers");

		const out = dc.waitForEvent("stopped");
		await dc.stepOutRequest({ threadId: 1 });
		await out;
		const afterOut = (await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames;
		expect(afterOut.map((f) => [f.name, f.line])).toEqual([
			[`outer (returns to line ${lineOf("yield")})`, lineOf("add Result Result 1")],
			["ic", lineOf("jal outer")],
		]);

		await dc.setBreakpointsRequest({ source: { path: CALLS }, breakpoints: [] });
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
	}, 60_000);

	it("stops on a halt as an exception, and shows an inline program's source", async () => {
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(launchArgs("halts on a bad register")),
			dc.assertStoppedLocation("exception", { line: 2 }),
		]);
		const stopped = (await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames[0]!;
		expect(stopped.source).toMatchObject({ name: "bad (inline code)", sourceReference: 1 });
		const source = await dc.sourceRequest({ source: stopped.source!, sourceReference: 1 });
		expect(source.body.content).toBe("move r0 1\nmove x 0");

		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
	}, 60_000);

	it("stops on entry when asked, before the first line", async () => {
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(launchArgs("counts once a tick", { stopOnEntry: true })),
			dc.assertStoppedLocation("entry", { path: COUNTER, line: 1 }),
		]);
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
	}, 60_000);

	it("runs the tick commands: Step Tick, Run N Ticks, Run Until Event", async () => {
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(launchArgs("counts on through dusk", { stopOnEntry: true })),
			dc.assertStoppedLocation("entry", { path: COUNTER, line: 1 }),
		]);
		const count = async () => (await dc.evaluateRequest({ expression: "Count", frameId: 1000 })).body.result;
		/** Send a tick command; VS Code must hear that the test ran on, then where it stopped. */
		const run = async (command: string, args: object) => {
			const continued = dc.waitForEvent("continued");
			const stopped = dc.waitForEvent("stopped");
			await dc.customRequest(command, args);
			expect((await continued).body).toMatchObject({ threadId: 1, allThreadsContinued: true });
			return (await stopped).body as DebugProtocol.StoppedEvent["body"];
		};

		const events = await dc.customRequest("events", {});
		expect(events.body.events).toEqual([{ kind: "at", label: "dusk", nextTick: 3 }]);

		// No thread given: the one that last stopped.
		expect(await run("stepTick", {})).toMatchObject({ reason: "step", threadId: 1 });
		expect((await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames[0]!.line).toBe(5); // after the yield
		expect(await count()).toBe("1");

		expect(await run("runTicks", { threadId: 1, ticks: 1 })).toMatchObject({ description: "Ran 1 tick: 2 done" });
		expect(await count()).toBe("2");

		expect(await run("runUntilEvent", { threadId: 1, label: "dusk" })).toMatchObject({
			reason: "event",
			description: 'Event "dusk" ran at the start of tick 3',
		});
		expect(await count()).toBe("3");
		await expect(dc.customRequest("runTicks", { ticks: 0 })).rejects.toThrow(/1 or more/);

		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
	}, 60_000);

	it("breaks on a value change, also with a data breakpoint kept from an earlier session", async () => {
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(launchArgs("counts once a tick", { stopOnEntry: true })),
			dc.assertStoppedLocation("entry", { path: COUNTER, line: 1 }),
		]);
		const registers = (await dc.scopesRequest({ frameId: 1000 })).body.scopes[0]!.variablesReference;
		const info = await dc.send("dataBreakpointInfo", { variablesReference: registers, name: "r0" });
		expect(info.body).toMatchObject({ description: "r0 on ic", accessTypes: ["write"], canPersist: true });
		const dataId = info.body.dataId as string;
		await dc.send("setDataBreakpoints", { breakpoints: [{ dataId }] });

		const stopped = dc.waitForEvent("stopped");
		await dc.continueRequest({ threadId: 1 });
		expect((await stopped).body).toMatchObject({ reason: "data breakpoint", description: "r0 on ic: 0 → 1, by line 3 (add Count Count 1)" });
		expect((await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames[0]!.line).toBe(4); // after it
		const terminated = dc.waitForEvent("terminated");
		await dc.terminateRequest({});
		await terminated;
		await dc.stop();

		// A new session gets the same data breakpoint before the test has connected.
		await dc.start((server.address() as { port: number }).port);
		const initialized = dc.waitForEvent("initialized");
		await dc.initializeRequest();
		const launched = dc.launch(launchArgs("counts once a tick"));
		await initialized;
		await dc.send("setDataBreakpoints", { breakpoints: [{ dataId, condition: "Count == 2" }] });
		const again = dc.waitForEvent("stopped");
		await dc.configurationDoneRequest();
		await launched;
		expect((await again).body.description).toBe("r0 on ic: 1 → 2, by line 3 (add Count Count 1)");
		const done = dc.waitForEvent("terminated");
		await dc.send("setDataBreakpoints", { breakpoints: [] });
		await dc.continueRequest({ threadId: 1 });
		await done;
	}, 90_000);

	// VS Code gives paths a lowercase drive letter. Run from there, Vitest used to load a second copy
	// of its runner, and the setup file's afterAll failed, so no test loaded.
	it.runIf(process.platform === "win32")("copes with a lowercase drive letter, as VS Code gives paths", async () => {
		const lower = (path: string) => path.replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
		const output = collectOutput(dc);
		await dc.hitBreakpoint({ ...launchArgs("counts once a tick"), test: lower(TESTS) }, { path: lower(COUNTER), line: 3 });
		await dc.setBreakpointsRequest({ source: { path: lower(COUNTER) }, breakpoints: [] });
		const exited = dc.waitForEvent("exited");
		await dc.continueRequest({ threadId: 1 });
		expect((await exited).body.exitCode, output()).toBe(0);
	}, 60_000);

	it("says it's starting Vitest straight away, and which process connected", async () => {
		const output = collectOutput(dc);
		await dc.hitBreakpoint(launchArgs("counts once a tick"), { path: COUNTER, line: 3 });
		expect(output()).toMatch(/^ic10-test: starting Vitest for chips\.debug\.ts, line \d+ \(in .+\)\n/);
		expect(output()).toMatch(/ic10-test: the test is connected \(process \d+\)/);
		await dc.setBreakpointsRequest({ source: { path: COUNTER }, breakpoints: [] });
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
	}, 60_000);

	it("on Stop, ends the test process, its worker (stopped at a breakpoint) included", async () => {
		const output = collectOutput(dc);
		await dc.hitBreakpoint(launchArgs("counts once a tick"), { path: COUNTER, line: 3 });
		const worker = Number(/the test is connected \(process (\d+)\)/.exec(output())![1]);
		expect(alive(worker)).toBe(true);
		const terminated = dc.waitForEvent("terminated");
		await dc.terminateRequest({});
		await terminated;
		for (let i = 0; i < 50 && alive(worker); i++) await new Promise((resolve) => setTimeout(resolve, 100));
		expect(alive(worker)).toBe(false);
	}, 60_000);

	it("hands another launcher (the JavaScript debugger's) only what to add to the environment, and ends without an exit code", async () => {
		// As the extension's js-debug launcher does: VS Code supplies the rest of the environment,
		// and a debug session ending says nothing about an exit code.
		let spec: LaunchSpec | undefined;
		launcher = (given, output) => {
			spec = given;
			const launched = spawnLauncher(given, output);
			return { exited: launched.exited.then(() => null), kill: launched.kill };
		};
		let exitedEvents = 0;
		dc.on("exited", () => exitedEvents++);
		await dc.hitBreakpoint(launchArgs("counts once a tick", { env: { IC10_EXAMPLE: "1" } }), { path: COUNTER, line: 3 });
		expect(spec!.env).toEqual({ IC10_EXAMPLE: "1", IC10_DEBUG: expect.stringMatching(/^\d+$/) });

		await dc.setBreakpointsRequest({ source: { path: COUNTER }, breakpoints: [] });
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		await terminated;
		expect(exitedEvents).toBe(0);
	}, 60_000);

	it("runs a scenario (a world module) with no test, and ends once nothing can change", async () => {
		const output = collectOutput(dc);
		const COUNTDOWN = join(FIXTURES, "countdown.ic10");
		await dc.hitBreakpoint({ scenario: join(FIXTURES, "countdown.world.ts") } as Ic10LaunchArgs, { path: COUNTDOWN, line: 4 });
		expect(output()).toMatch(/^ic10-test: starting the scenario for countdown\.world\.ts/);
		const left = await dc.evaluateRequest({ expression: "Left", context: "watch" });
		expect(left.body.result).toBe("3");

		await dc.setBreakpointsRequest({ source: { path: COUNTDOWN }, breakpoints: [] });
		const exited = dc.waitForEvent("exited");
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		expect((await exited).body.exitCode, output()).toBe(0);
		await terminated;
		expect(output()).toMatch(/every chip has stopped and no events are due \(tick \d+\)/);
	}, 60_000);

	it("runs env JSON as a scenario, with an .ic10 file as a chip's program", async () => {
		const EXAMPLES = join(import.meta.dirname, "..", "examples");
		const SCRIPT = join(EXAMPLES, "scenario.ic10");
		const line = readFileSync(SCRIPT, "utf8").split("\n").findIndex((l) => l.startsWith("add Nights")) + 1;
		const args = { scenario: join(EXAMPLES, "scenario.env.json"), program: SCRIPT } as Ic10LaunchArgs;
		await dc.hitBreakpoint(args, { path: SCRIPT, line });
		const frame = (await dc.stackTraceRequest({ threadId: 1 })).body.stackFrames[0]!;
		expect(frame).toMatchObject({ line, source: { path: SCRIPT } });
		const terminated = dc.waitForEvent("terminated");
		await dc.terminateRequest({});
		await terminated;
	}, 60_000);

	it("says why a launch can't start", async () => {
		await dc.initializeRequest();
		await expect(dc.launchRequest({ test: join(FIXTURES, "missing.debug.ts") } as Ic10LaunchArgs)).rejects.toThrow(
			/no test file/,
		);
	});

	it("runs Vitest where its config is", () => {
		expect(findVitestRoot(FIXTURES)).toBe(FIXTURES);
		expect(findVitestRoot(join(import.meta.dirname))).toBe(join(import.meta.dirname, "..", ".."));
	});
});
