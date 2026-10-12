import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentMessage, type Command, type EventMessage, PROTOCOL_VERSION, type Requests } from "../src/debug/protocol.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "debug");
const VITEST = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

/** The adapter's end of a socket, as the extension will have it: requests out, responses and events in. */
class SocketAdapter {
	readonly events: EventMessage[] = [];
	private socket!: Socket;
	private seq = 1;
	private readonly pending = new Map<number, (m: AgentMessage) => void>();
	private readonly waiters: (() => void)[] = [];

	attach(socket: Socket): void {
		this.socket = socket;
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				const message = JSON.parse(buffer.slice(0, newline)) as AgentMessage;
				buffer = buffer.slice(newline + 1);
				if (message.type === "response") this.pending.get(message.seq)?.(message);
				else this.events.push(message);
				for (const wake of this.waiters.splice(0)) wake();
			}
		});
	}

	request<K extends Command>(command: K, args: Requests[K]["args"]): Promise<Requests[K]["result"]> {
		const seq = this.seq++;
		return new Promise((resolve, reject) => {
			this.pending.set(seq, (m) => {
				if (m.type !== "response") return;
				if (m.ok) resolve(m.result as Requests[K]["result"]);
				else reject(new Error(m.error));
			});
			this.socket.write(`${JSON.stringify({ type: "request", seq, command, args })}\n`);
		});
	}

	/** The `n`th event of a kind (0-based), waiting for it. */
	async event<E extends EventMessage["event"]>(event: E, n = 0): Promise<Extract<EventMessage, { event: E }>> {
		for (;;) {
			const found = this.events.filter((e) => e.event === event);
			if (found.length > n) return found[n] as Extract<EventMessage, { event: E }>;
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
	}
}

/** Line (1-based) of the `it(` whose name is given, as Vitest's `file:line` filter wants it. */
function lineOf(file: string, name: string): number {
	const lines = readFileSync(file, "utf8").split("\n");
	return lines.findIndex((l) => l.includes(`it("${name}"`)) + 1;
}

describe("attaching from Vitest", () => {
	it("runs one test under the debugger: stops at a breakpoint, steps, edits, and says when it's done", async () => {
		const adapter = new SocketAdapter();
		const server: Server = createServer();
		const connected = new Promise<void>((resolve) => {
			server.once("connection", (socket) => {
				adapter.attach(socket);
				resolve();
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;

		const testFile = join(FIXTURES, "counter.debug.ts");
		const child = spawn(
			process.execPath,
			[VITEST, "run", `${testFile}:${lineOf(testFile, "counts once a tick")}`, "--testTimeout=0"],
			{ cwd: FIXTURES, env: { ...process.env, IC10_DEBUG: String(port) } },
		);
		let output = "";
		child.stdout.on("data", (d) => (output += d));
		child.stderr.on("data", (d) => (output += d));
		const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

		try {
			await connected;
			expect(await adapter.event("hello")).toMatchObject({ version: PROTOCOL_VERSION });
			const script = join(FIXTURES, "counter.ic10");
			await adapter.request("setBreakpoints", { path: script, breakpoints: [{ line: 2 }] });
			await adapter.request("configurationDone", {});

			const stop = await adapter.event("stopped");
			expect(stop.reason).toBe("breakpoint");
			const { frames } = await adapter.request("stackTrace", { thread: stop.thread });
			expect(frames[0]).toMatchObject({ line: 2, path: script, text: "add Count Count 1" });
			expect(await adapter.request("evaluate", { thread: stop.thread, expression: "Count" })).toEqual({ value: "0", ref: 0 });

			await adapter.request("next", { thread: stop.thread });
			await adapter.event("stopped", 1);
			expect((await adapter.request("evaluate", { thread: stop.thread, expression: "Count" })).value).toBe("1");

			// Count from 10, so the test's expectation (3) now fails: the edit really reaches the test.
			const { scopes } = await adapter.request("scopes", { thread: stop.thread });
			await adapter.request("setVariable", { ref: scopes[0]!.ref, name: "r0 (Count)", value: "10" });
			await adapter.request("setBreakpoints", { path: script, breakpoints: [] });
			await adapter.request("continue", {});

			await adapter.event("terminated");
			expect(await exited).toBe(1);
			expect(output).toMatch(/expected.*Count.*3/is);
			expect(output).toMatch(/1 failed \| 1 skipped/);
		} finally {
			child.kill();
			server.close();
		}
	}, 60_000);
});
