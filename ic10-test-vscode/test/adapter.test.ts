import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { DebugClient } from "@vscode/debugadapter-testsupport";
import type { DebugProtocol } from "@vscode/debugprotocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findVitestRoot, type Ic10LaunchArgs, Ic10TestSession } from "../src/adapter.ts";

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

/** Everything the adapter printed (Vitest's output among it), for failure messages and checks. */
function collectOutput(dc: DebugClient): () => string {
	let text = "";
	dc.on("output", (e: DebugProtocol.OutputEvent) => (text += e.body.output));
	return () => text;
}

describe("debug adapter", () => {
	let server: Server;
	let dc: DebugClient;

	beforeEach(async () => {
		// The adapter runs in this process, as it will inside VS Code; the client talks to it over a socket.
		server = createServer((socket) => {
			const session = new Ic10TestSession();
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
		expect(frame).toMatchObject({ id: 1, name: "add Count Count 1", line: 3, source: { path: COUNTER, name: "counter.ic10" } });

		const scopes = (await dc.scopesRequest({ frameId: frame.id })).body.scopes;
		expect(scopes.map((s) => s.name)).toEqual(["Registers", "Stack", "Devices", "World", "Defines"]);
		const registers = (await dc.variablesRequest({ variablesReference: scopes[0]!.variablesReference })).body.variables;
		expect(registers[0]).toMatchObject({ name: "r0 (Count)", value: "0", evaluateName: "r0" });

		const stepped = dc.waitForEvent("stopped");
		await dc.nextRequest({ threadId: 1 });
		expect((await stepped).body).toMatchObject({ reason: "step", threadId: 1, allThreadsStopped: true });
		expect((await dc.evaluateRequest({ expression: "Count", frameId: 1, context: "hover" })).body.result).toBe("1");

		const refs = (await dc.scopesRequest({ frameId: 1 })).body.scopes[0]!.variablesReference;
		const set = await dc.setVariableRequest({ variablesReference: refs, name: "r0 (Count)", value: "1" });
		expect(set.body.value).toBe("1");

		await dc.setBreakpointsRequest({ source: { path: COUNTER }, breakpoints: [] });
		const exited = dc.waitForEvent("exited");
		const terminated = dc.waitForEvent("terminated");
		await dc.continueRequest({ threadId: 1 });
		expect((await exited).body.exitCode, output()).toBe(0);
		await terminated;
		expect(output()).toMatch(/1 passed \| 1 skipped/);
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
