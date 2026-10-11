import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DebugAgent, type Transport } from "../src/debug/agent.ts";
import type { AdapterMessage, AgentMessage, Command, EventMessage, Requests } from "../src/debug/protocol.ts";
import { evaluate, evaluateCondition } from "../src/debug/evaluate.ts";
import { sim, type World } from "../src/index.ts";

type Stopped = Extract<EventMessage, { event: "stopped" }>;

/** The adapter's side, in memory. Messages arrive on a later turn of the event loop, as from a socket. */
class FakeAdapter {
	readonly events: EventMessage[] = [];
	private deliver!: (message: AdapterMessage) => void;
	private seq = 1;
	private readonly pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
	private stopsSeen = 0;
	private waiter: (() => void) | null = null;

	readonly transport: Transport = {
		send: (message) => setImmediate(() => this.receive(message)),
		onMessage: (handler) => {
			this.deliver = handler;
		},
	};

	request<K extends Command>(command: K, args: Requests[K]["args"]): Promise<Requests[K]["result"]> {
		const seq = this.seq++;
		return new Promise((resolve, reject) => {
			this.pending.set(seq, { resolve: resolve as (r: unknown) => void, reject });
			setImmediate(() => this.deliver({ type: "request", seq, command, args } as AdapterMessage));
		});
	}

	/** The next stop not yet returned (waiting for it if need be). */
	async nextStop(): Promise<Stopped> {
		for (;;) {
			const stops = this.events.filter((e): e is Stopped => e.event === "stopped");
			if (stops.length > this.stopsSeen) return stops[this.stopsSeen++]!;
			await new Promise<void>((resolve) => {
				this.waiter = resolve;
			});
		}
	}

	output(): string[] {
		return this.events.flatMap((e) => (e.event === "output" ? [e.text] : []));
	}

	private receive(message: AgentMessage): void {
		if (message.type === "response") {
			const pending = this.pending.get(message.seq)!;
			this.pending.delete(message.seq);
			if (message.ok) pending.resolve(message.result);
			else pending.reject(new Error(message.error));
			return;
		}
		this.events.push(message);
		this.waiter?.();
		this.waiter = null;
	}
}

const SCRIPT = [
	"alias Stage r15", // 0
	"move Stage 0", // 1
	"loop:", // 2
	"add Stage Stage 1", // 3
	"jal sub", // 4
	"yield", // 5
	"j loop", // 6
	"sub:", // 7
	"move r1 Stage", // 8
	"j ra", // 9
].join("\n");

function scriptFile(text = SCRIPT): string {
	const dir = mkdtempSync(join(tmpdir(), "ic10-agent-"));
	const path = join(dir, "script.ic10");
	writeFileSync(path, text);
	return path;
}

/** A world running `file` under a debug agent, and the fake adapter driving it. */
async function debugged(file = scriptFile(), options: Parameters<typeof sim>[0] = {}) {
	const adapter = new FakeAdapter();
	const agent = new DebugAgent(adapter.transport);
	const world = await sim({ debug: agent.gate, ...options })
		.housing("ic", { file })
		.build();
	return { adapter, agent, world, file, ic: world.chip("ic") };
}

async function lineOf(adapter: FakeAdapter, thread: number): Promise<number> {
	const { frames } = await adapter.request("stackTrace", { thread });
	return frames[0]!.line;
}

describe("debug agent", () => {
	it("says hello, then holds the test back until the adapter has set its breakpoints", async () => {
		const { adapter, world, ic } = await debugged();
		const run = world.runTicks(1);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(adapter.events[0]).toMatchObject({ event: "hello", version: 1 });
		expect(ic.linesExecuted).toBe(0);
		await adapter.request("configurationDone", {});
		await run;
		expect(ic.reg("Stage")).toBe(1);
	});

	it("stops at a breakpoint in the file, before the line runs, every time it comes round", async () => {
		const { adapter, world, file, ic } = await debugged();
		const set = await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 3 }] });
		expect(set.breakpoints).toEqual([{ line: 3, verified: true }]);
		await adapter.request("configurationDone", {});
		const run = world.runTicks(3);

		const first = await adapter.nextStop();
		expect(first).toMatchObject({ reason: "breakpoint", thread: 1 });
		const { frames } = await adapter.request("stackTrace", { thread: 1 });
		expect(frames).toEqual([{ thread: 1, name: "ic", line: 3, text: "add Stage Stage 1", path: file }]);
		expect(ic.reg("Stage")).toBe(0);

		await adapter.request("continue", {});
		await adapter.nextStop();
		expect(ic.reg("Stage")).toBe(1);

		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("continue", {});
		await run;
		expect(ic.reg("Stage")).toBe(3);
	});

	it("stops at a conditional breakpoint only when the condition holds", async () => {
		const { adapter, world, file, ic } = await debugged();
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 3, condition: "Stage == 2" }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(5);
		await adapter.nextStop();
		expect(ic.reg("Stage")).toBe(2);
		await adapter.request("continue", {});
		await run;
	});

	it("prints a log message instead of stopping", async () => {
		const { adapter, world, file } = await debugged();
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 8, logMessage: "stage {Stage}, r1 {r1}" }] });
		await adapter.request("configurationDone", {});
		await world.runTicks(2);
		await new Promise((resolve) => setImmediate(resolve));
		expect(adapter.output()).toEqual(["stage 1, r1 0\n", "stage 2, r1 1\n"]);
	});

	it("steps over a jal call, into it, and out of it", async () => {
		const { adapter, world, file } = await debugged();
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 4 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(3);

		await adapter.nextStop(); // at the jal (tick 0)
		await adapter.request("next", { thread: 1 });
		expect(await adapter.nextStop()).toMatchObject({ reason: "step" });
		expect(await lineOf(adapter, 1)).toBe(5); // over the call: the yield after it

		await adapter.request("continue", {});
		await adapter.nextStop(); // at the jal again (tick 1)
		await adapter.request("stepIn", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(8); // into sub
		await adapter.request("stepOut", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(5); // back after the jal

		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("continue", {});
		await run;
	});

	it("steps over a call to the first instruction after it, past comments", async () => {
		const { adapter, world } = await debugged(scriptFile("jal sub\n# back\n\nmove r0 1\nyield\nsub:\nj ra"));
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		await adapter.nextStop();
		await adapter.request("next", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(3);
		await adapter.request("continue", {});
		await run;
	});

	it("steps one instruction at a time from the entry, past label lines", async () => {
		const { adapter, world } = await debugged();
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		expect(await adapter.nextStop()).toMatchObject({ reason: "entry" });
		const lines = [await lineOf(adapter, 1)];
		for (let i = 0; i < 4; i++) {
			await adapter.request("stepIn", { thread: 1 });
			await adapter.nextStop();
			lines.push(await lineOf(adapter, 1));
		}
		expect(lines).toEqual([0, 1, 3, 4, 8]); // 2 and 7 are labels
		await adapter.request("continue", {});
		await run;
	});

	it("pauses a long run, reading Pause between lines", async () => {
		const { adapter, world, ic } = await debugged();
		await adapter.request("configurationDone", {});
		let done = false;
		const run = world.runUntil(() => done, { maxTicks: 1e9 });
		await new Promise((resolve) => setTimeout(resolve, 30));
		await adapter.request("pause", {});
		expect(await adapter.nextStop()).toMatchObject({ reason: "pause", thread: 1 });
		const ticks = world.tick;
		expect(ticks).toBeGreaterThan(0);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(world.tick).toBe(ticks); // stopped means stopped
		expect(ic.reg("Stage")).toBeGreaterThan(0);
		done = true;
		await adapter.request("continue", {});
		await run;
	});

	it("stops when a chip halts, naming the error, and not when that's switched off", async () => {
		const halting = scriptFile("move r0 1\nmove x 0");
		const first = await debugged(halting);
		await first.adapter.request("configurationDone", {});
		const run = first.world.runTicks(1);
		const stop = await first.adapter.nextStop();
		expect(stop).toMatchObject({ reason: "halt", thread: 1 });
		expect(stop.description).toMatch(/^Halted at line 2: /);
		expect(await lineOf(first.adapter, 1)).toBe(1);
		await first.adapter.request("continue", {});
		await run;

		const second = await debugged(halting);
		await second.adapter.request("setExceptionFilters", { halt: false, autoYield: false });
		await second.adapter.request("configurationDone", {});
		await second.world.runTicks(1);
		expect(second.ic.halted).toBe(true);
		expect(second.adapter.events.some((e) => e.event === "stopped")).toBe(false);
	});

	it("stops on an automatic yield when asked to", async () => {
		const { adapter, world } = await debugged(scriptFile("move r0 1\nmove r0 2\nmove r0 3\nyield"), { linesPerTick: 2 });
		await adapter.request("setExceptionFilters", { halt: true, autoYield: true });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		const stop = await adapter.nextStop();
		expect(stop).toMatchObject({ reason: "autoYield" });
		expect(stop.description).toMatch(/2 lines used in tick 0, after line 2/);
		await adapter.request("continue", {});
		await run;
	});

	it("moves on to the next chip when a stepped chip runs off the end of its program", async () => {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const world = await sim({ debug: agent.gate })
			.housing("a", { code: "move r0 1" })
			.housing("b", { code: "move r0 2\nyield" })
			.build();
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		expect(await adapter.nextStop()).toMatchObject({ reason: "entry", thread: 1 });
		await adapter.request("stepIn", { thread: 1 });
		expect(await adapter.nextStop()).toMatchObject({ reason: "step", thread: 2 });
		await adapter.request("continue", {});
		await run;
	});

	it("gives each chip of each world a thread, and serves inline programs' text", async () => {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const build = (): Promise<World> =>
			sim({ debug: agent.gate }).housing("ic", { code: "move r0 1\nyield" }).build();
		const one = await build();
		const two = await build();
		await adapter.request("configurationDone", {});
		await one.runTicks(1);
		await two.runTicks(1);
		const { threads } = await adapter.request("threads", {});
		expect(threads).toEqual([
			{ id: 1, name: "ic", chip: "ic", world: 1 },
			{ id: 2, name: "ic (world 2)", chip: "ic", world: 2 },
		]);
		const { frames } = await adapter.request("stackTrace", { thread: 2 });
		expect(frames[0]).toMatchObject({ line: 2, sourceRef: 2 }); // after the yield
		expect(frames[0]!.path).toBeUndefined();
		expect((await adapter.request("source", { sourceRef: 2 })).content).toBe("move r0 1\nyield");
	});

	it("answers a bad request with an error", async () => {
		const { adapter } = await debugged();
		await expect(adapter.request("stackTrace", { thread: 99 })).rejects.toThrow("no thread 99");
	});
});

describe("evaluate", () => {
	it("reads numbers, registers, aliases, defines, labels and device properties", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent", { On: 1 })
			.housing("ic", {
				code: "alias Stage r15\nalias Vent d0\ndefine Max 5\nstart:\nmove Stage 3\nyield",
				pins: { d0: "vent" },
				props: { Setting: 7 },
			})
			.build();
		await world.runTicks(1);
		const ic = world.chip("ic");
		expect([evaluate(ic, "2.5"), evaluate(ic, "$1F"), evaluate(ic, "%101"), evaluate(ic, "-1")]).toEqual([2.5, 31, 5, -1]);
		expect([evaluate(ic, "Stage"), evaluate(ic, "r15"), evaluate(ic, "Max"), evaluate(ic, "start")]).toEqual([3, 3, 5, 3]);
		expect([evaluate(ic, "d0.On"), evaluate(ic, "Vent.On"), evaluate(ic, "vent.On"), evaluate(ic, "db.Setting")]).toEqual([1, 1, 1, 7]);
		expect(() => evaluate(ic, "Vent")).toThrow(/is the device d0/);
		expect(() => evaluate(ic, "nope")).toThrow(/isn't a register/);
		expect(() => evaluate(ic, "d3.On")).toThrow(/nothing is on d3/);
		expect(evaluateCondition(ic, "Stage >= 3")).toBe(true);
		expect(evaluateCondition(ic, "Vent.On != 1")).toBe(false);
		expect(evaluateCondition(ic, "Stage")).toBe(true);
	});
});
