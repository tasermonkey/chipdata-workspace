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
		expect(adapter.events[0]).toMatchObject({ event: "hello", version: 2 });
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

	it("steps over a recursive call to where this level gets back, not where a deeper one does", async () => {
		const RECURSIVE = [
			"move r0 3", // 0
			"jal f", // 1
			"yield", // 2
			"f:", // 3
			"push ra", // 4
			"sub r0 r0 1", // 5
			"blez r0 done", // 6
			"jal f", // 7: the recursive call
			"done:", // 8
			"pop ra", // 9
			"j ra", // 10
		].join("\n");
		const { adapter, world, file, ic } = await debugged(scriptFile(RECURSIVE));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 7 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		await adapter.nextStop(); // the outermost f, about to recurse
		expect([ic.reg("r0"), ic.sp]).toEqual([2, 1]);
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("next", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(9); // pop ra, past the done: label
		expect([ic.reg("r0"), ic.sp]).toEqual([0, 1]); // the deeper calls have all returned
		await adapter.request("continue", {});
		await run;
	});

	it("shows the call stack: a frame for each call, named by its label and where it returns to", async () => {
		const NESTED = [
			"start:", // 0
			"jal outer", // 1
			"yield", // 2
			"j start", // 3
			"outer:", // 4
			"push ra", // 5
			"jal inner", // 6
			"pop ra", // 7
			"j ra", // 8
			"inner:", // 9
			"move r1 1", // 10
			"j ra", // 11
		].join("\n");
		const { adapter, world, file } = await debugged(scriptFile(NESTED));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 10 }, { line: 2 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(2);
		await adapter.nextStop();
		const frames = (await adapter.request("stackTrace", { thread: 1 })).frames;
		expect(frames.map((f) => [f.name, f.line, f.text])).toEqual([
			["inner (returns to line 8)", 10, "move r1 1"],
			["outer (returns to line 3)", 6, "jal inner"],
			["ic", 1, "jal outer"],
		]);
		await adapter.request("continue", {});
		await adapter.nextStop(); // at the yield: both calls have returned
		expect((await adapter.request("stackTrace", { thread: 1 })).frames.map((f) => f.name)).toEqual(["ic"]);
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("continue", {});
		await run;
	});

	it("shows a frame for each level of a recursive call", async () => {
		const RECURSIVE = "move r0 3\njal f\nyield\nf:\npush ra\nsub r0 r0 1\nblez r0 done\njal f\ndone:\npop ra\nj ra";
		const { adapter, world, file } = await debugged(scriptFile(RECURSIVE));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 9, condition: "r0 == 0" }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		await adapter.nextStop(); // the deepest call, about to unwind
		const frames = (await adapter.request("stackTrace", { thread: 1 })).frames;
		expect(frames.map((f) => [f.name, f.line])).toEqual([
			["f (returns to line 9)", 9],
			["f (returns to line 9)", 7],
			["f (returns to line 3)", 7],
			["ic", 1],
		]);
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("continue", {});
		await run;
	});

	it("drops calls when the chip restarts", async () => {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const file = scriptFile("jal f\nyield\nf:\nyield\nj f");
		const world = await sim({ debug: agent.gate }).housing("ic", { file }).build();
		world.at({ tick: 1 }, (w) => w.device("ic").set("On", 0));
		world.at({ tick: 2 }, (w) => w.device("ic").set("On", 1));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 3 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(3);
		await adapter.nextStop(); // in f, tick 0
		expect((await adapter.request("stackTrace", { thread: 1 })).frames).toHaveLength(2);
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 0 }] });
		await adapter.request("continue", {});
		await adapter.nextStop(); // back at line 0 after the restart in tick 2
		expect((await adapter.request("stackTrace", { thread: 1 })).frames.map((f) => [f.name, f.line])).toEqual([["ic", 0]]);
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("continue", {});
		await run;
	});

	it("steps over a call that leaves a result on the stack", async () => {
		const { adapter, world, ic } = await debugged(scriptFile("jal f\nyield\nf:\npush 42\nj ra"));
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		await adapter.nextStop();
		await adapter.request("next", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(1);
		expect(ic.stack()).toEqual([42]);
		await adapter.request("continue", {});
		await run;
	});

	it("steps out of a function past the calls it makes, and out of a recursive call one level", async () => {
		const NESTED = [
			"jal outer", // 0
			"yield", // 1
			"outer:", // 2
			"push ra", // 3
			"jal inner", // 4
			"pop ra", // 5
			"j ra", // 6
			"inner:", // 7
			"move r1 1", // 8
			"j ra", // 9
		].join("\n");
		const { adapter, world, file } = await debugged(scriptFile(NESTED));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 4 }, { line: 8 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		await adapter.nextStop(); // in outer, before it calls inner
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 8 }] });
		await adapter.request("stepOut", { thread: 1 });
		const stop = await adapter.nextStop(); // the breakpoint in inner comes first
		expect(stop.reason).toBe("breakpoint");
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("stepOut", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(5); // out of inner, back in outer
		await adapter.request("stepOut", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(1); // out of outer
		await adapter.request("continue", {});
		await run;

		const RECURSIVE = "move r0 2\njal f\nyield\nf:\npush ra\nsub r0 r0 1\nblez r0 done\njal f\ndone:\npop ra\nj ra";
		const second = await debugged(scriptFile(RECURSIVE));
		const path = second.file;
		await second.adapter.request("setBreakpoints", { path, breakpoints: [{ line: 5, condition: "r0 == 1" }] });
		await second.adapter.request("configurationDone", {});
		const run2 = second.world.runTicks(1);
		await second.adapter.nextStop(); // in the deeper call (sp 2)
		expect(second.ic.sp).toBe(2);
		await second.adapter.request("setBreakpoints", { path, breakpoints: [] });
		await second.adapter.request("stepOut", { thread: 1 });
		await second.adapter.nextStop();
		expect(await lineOf(second.adapter, 1)).toBe(9); // back in the outer call: pop ra, past the done: label
		expect(second.ic.sp).toBe(1);
		await second.adapter.request("continue", {});
		await run2;
	});

	it("steps out of a function when stopped before its own calls, not at the first inner return", async () => {
		const NESTED = "jal outer\nyield\nouter:\npush ra\njal inner\npop ra\nj ra\ninner:\nmove r1 1\nj ra";
		const { adapter, world, file } = await debugged(scriptFile(NESTED));
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 4 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		await adapter.nextStop(); // in outer after its push ra: an inner return has the same sp
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		await adapter.request("stepOut", { thread: 1 });
		await adapter.nextStop();
		expect(await lineOf(adapter, 1)).toBe(1);
		await adapter.request("continue", {});
		await run;
	});

	it("stops at the halt inside a call being stepped over", async () => {
		const { adapter, world, ic } = await debugged(scriptFile("jal sub\nyield\nsub:\nmove x 0\nj ra"));
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		await adapter.nextStop();
		await adapter.request("next", { thread: 1 });
		const stop = await adapter.nextStop();
		expect(stop).toMatchObject({ reason: "halt", thread: 1 });
		expect(stop.description).toMatch(/^Halted at line 4: /);
		expect(await lineOf(adapter, 1)).toBe(3); // inside sub, where it failed
		await adapter.request("continue", {});
		await run;
		expect(ic.halted).toBe(true);
		expect(adapter.events.filter((e) => e.event === "stopped")).toHaveLength(2); // nothing more
	});

	it("with halt stops off, a step over a call that halts stops at the next chip's next instruction", async () => {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const world = await sim({ debug: agent.gate })
			.housing("a", { code: "jal sub\nyield\nsub:\nmove x 0\nj ra" })
			.housing("b", { code: "move r0 2\nyield" })
			.build();
		await adapter.request("setExceptionFilters", { halt: false, autoYield: false });
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(1);
		expect(await adapter.nextStop()).toMatchObject({ reason: "entry", thread: 1 });
		await adapter.request("next", { thread: 1 });
		expect(await adapter.nextStop()).toMatchObject({ reason: "step", thread: 2 });
		expect(world.chip("a").halted).toBe(true);
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

	it("lets a stopped test run on when the debugger goes away", async () => {
		const { adapter, agent, world, file, ic } = await debugged();
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 3 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(3);
		await adapter.nextStop();
		agent.detach();
		await run;
		expect(ic.reg("Stage")).toBe(3);
	});

	it("answers a bad request with an error", async () => {
		const { adapter } = await debugged();
		await expect(adapter.request("stackTrace", { thread: 99 })).rejects.toThrow("no thread 99");
	});
});

describe("debug agent: tick commands", () => {
	it("Step Tick runs to the chip's first instruction in its next turn", async () => {
		const { adapter, world, file, ic } = await debugged();
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 3 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(5);
		await adapter.nextStop(); // mid-turn in tick 0
		await adapter.request("setBreakpoints", { path: file, breakpoints: [] });
		for (const tick of [1, 2]) {
			await adapter.request("stepTick", { thread: 1 });
			expect(await adapter.nextStop()).toMatchObject({ reason: "tick", thread: 1 });
			expect(await lineOf(adapter, 1)).toBe(6); // after the yield
			expect([world.tick, ic.reg("Stage")]).toEqual([tick, tick]);
		}
		// Each said it ran on, ahead of its stop (VS Code doesn't know a custom request runs on).
		expect(adapter.events.filter((e) => e.event === "continued" || e.event === "stopped").map((e) => e.event)).toEqual([
			"stopped",
			"continued",
			"stopped",
			"continued",
			"stopped",
		]);
		await adapter.request("continue", {});
		await run;
	});

	it("Step Tick waits out a sleep and an automatic yield", async () => {
		const sleeper = await debugged(scriptFile("move r0 1\nsleep 1\nmove r0 2\nyield")); // 2 ticks of 0.5 s
		await sleeper.adapter.request("configurationDone", { stopOnEntry: true });
		const run = sleeper.world.runTicks(5);
		await sleeper.adapter.nextStop();
		await sleeper.adapter.request("stepTick", { thread: 1 });
		await sleeper.adapter.nextStop();
		expect([await lineOf(sleeper.adapter, 1), sleeper.world.tick]).toEqual([2, 2]);
		await sleeper.adapter.request("continue", {});
		await run;

		const busy = await debugged(scriptFile("move r0 1\nmove r0 2\n# full\nmove r0 3\nyield"), { linesPerTick: 2 });
		await busy.adapter.request("configurationDone", { stopOnEntry: true });
		const run2 = busy.world.runTicks(2);
		await busy.adapter.nextStop();
		await busy.adapter.request("stepTick", { thread: 1 });
		await busy.adapter.nextStop();
		expect([await lineOf(busy.adapter, 1), busy.world.tick]).toEqual([3, 1]); // past the comment
		await busy.adapter.request("continue", {});
		await run2;
	});

	it("Step Tick on a chip yet to run in this tick stops at its turn in this tick", async () => {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const world = await sim({ debug: agent.gate })
			.housing("a", { code: "move r0 1\nyield" })
			.housing("b", { code: "move r0 2\nyield" })
			.build();
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(2);
		expect(await adapter.nextStop()).toMatchObject({ reason: "entry", thread: 1 });
		await adapter.request("stepTick", { thread: 2 });
		expect(await adapter.nextStop()).toMatchObject({ reason: "tick", thread: 2 });
		expect([await lineOf(adapter, 2), world.tick]).toEqual([0, 0]);
		await adapter.request("continue", {});
		await run;
	});

	it("refuses Step Tick for a chip that has halted", async () => {
		const { adapter, world } = await debugged(scriptFile("move x 0"));
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		expect(await adapter.nextStop()).toMatchObject({ reason: "halt" });
		await expect(adapter.request("stepTick", { thread: 1 })).rejects.toThrow("ic has halted, so it has no next turn");
		await adapter.request("continue", {});
		await run;
	});

	it("Run N Ticks stops between ticks once that many have finished, the tick in progress counting", async () => {
		const { adapter, world, ic } = await debugged();
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(10);
		await adapter.nextStop(); // tick 0 in progress
		await adapter.request("runTicks", { thread: 1, ticks: 3 });
		expect(await adapter.nextStop()).toMatchObject({ reason: "tick", thread: 1, description: "Ran 3 ticks: 3 done" });
		expect([world.tick, ic.reg("Stage")]).toEqual([3, 3]);
		await adapter.request("runTicks", { thread: 1, ticks: 1 }); // between ticks: one whole tick
		expect(await adapter.nextStop()).toMatchObject({ description: "Ran 1 tick: 4 done" });
		expect([world.tick, ic.reg("Stage")]).toEqual([4, 4]);
		await expect(adapter.request("runTicks", { thread: 1, ticks: 0 })).rejects.toThrow(/1 or more/);
		await adapter.request("continue", {});
		await run;
	});

	it("Run N Ticks stops while every chip sleeps, and Pause gets through too", async () => {
		const { adapter, world } = await debugged(scriptFile("loop:\nsleep 1000\nj loop"));
		await adapter.request("configurationDone", { stopOnEntry: true });
		let done = false;
		const run = world.runUntil(() => done, { maxTicks: 1e9 });
		await adapter.nextStop();
		await adapter.request("runTicks", { thread: 1, ticks: 50 });
		await adapter.nextStop();
		expect(world.tick).toBe(50);
		await adapter.request("continue", {});
		await new Promise((resolve) => setTimeout(resolve, 30));
		await adapter.request("pause", {});
		expect(await adapter.nextStop()).toMatchObject({ reason: "pause" });
		expect(world.tick).toBeGreaterThan(50);
		done = true;
		await adapter.request("continue", {});
		await run;
	});

	it("lists the events to come, and runs until one fires, by label or any", async () => {
		const { adapter, world, ic } = await debugged();
		world.at({ tick: 3 }, () => {}, { label: "dusk" });
		world.every({ ticks: 2 }, () => {}, { label: "pulse" });
		await adapter.request("configurationDone", { stopOnEntry: true });
		const run = world.runTicks(10);
		await adapter.nextStop();
		expect((await adapter.request("events", { thread: 1 })).events).toEqual([
			{ kind: "at", label: "dusk", nextTick: 3 },
			{ kind: "every", label: "pulse", nextTick: 2, interval: 2 },
		]);
		await adapter.request("runUntilEvent", { thread: 1, label: "dusk" });
		const stop = await adapter.nextStop();
		expect(stop).toMatchObject({ reason: "event", thread: 1, description: 'Event "dusk" ran at the start of tick 3' });
		expect([world.tick, ic.reg("Stage")]).toEqual([3, 3]); // before the chip's turn in tick 3
		await adapter.request("runUntilEvent", { thread: 1 });
		expect((await adapter.nextStop()).description).toBe('Event "pulse" ran at the start of tick 4');
		await adapter.request("continue", {});
		await run;
	});
});

describe("debug agent: what you see while stopped", () => {
	const CODE = [
		"alias Stage r15",
		"alias Vent d0",
		"define Max 5",
		"move Stage 2",
		"move r1 $1001", // the vent's reference ID
		"push 7",
		"push 8",
		"put db 10 3", // above sp
		"s Vent On 1",
		"yield", // 9
	].join("\n");

	async function stopped() {
		const adapter = new FakeAdapter();
		const agent = new DebugAgent(adapter.transport);
		const file = scriptFile(CODE);
		const world = await sim({ debug: agent.gate })
			.pipe("coolant", { volume: 100, temperature: 300, gases: { Nitrogen: 1 } })
			.device("vent", "StructureActiveVent")
			.device("pa", "StructurePipeAnalysizer", {}, { pipe: "coolant" })
			.housing("ic", { file, pins: { d0: "vent" } })
			.build();
		world.at({ tick: 4 }, () => {}, { label: "dusk" });
		await adapter.request("setBreakpoints", { path: file, breakpoints: [{ line: 9 }] });
		await adapter.request("configurationDone", {});
		const run = world.runTicks(1);
		await adapter.nextStop();
		const { scopes } = await adapter.request("scopes", { thread: 1 });
		const scope = async (name: string) => {
			const ref = scopes.find((s) => s.name === name)!.ref;
			return { ref, rows: (await adapter.request("variables", { ref })).variables };
		};
		return { adapter, world, run, scopes, scope, ic: world.chip("ic") };
	}

	it("has the scopes from the plan", async () => {
		const { scopes, adapter, run } = await stopped();
		expect(scopes.map((s) => s.name)).toEqual(["Registers", "Stack", "Devices", "Atmospheres", "World", "Defines"]);
		await adapter.request("continue", {});
		await run;
	});

	it("shows registers with their aliases and labels reference IDs, and edits them", async () => {
		const { adapter, run, scope, ic } = await stopped();
		const { ref, rows } = await scope("Registers");
		expect(rows.find((r) => r.name === "r15 (Stage)")).toMatchObject({ value: "2", evaluateName: "r15" });
		expect(rows.find((r) => r.name === "r1")?.value).toBe("4097 (→ vent $1001)");
		expect(rows.find((r) => r.name === "r16 (sp)")?.value).toBe("2");
		expect(await adapter.request("setVariable", { ref, name: "r15 (Stage)", value: "Max" })).toEqual({ value: "5", ref: 0 });
		expect(ic.reg("Stage")).toBe(5);
		await adapter.request("continue", {});
		await run;
	});

	it("shows the stack up to sp, the top marked, and entries above it that hold something", async () => {
		const { adapter, run, scope, ic } = await stopped();
		const { ref, rows } = await scope("Stack");
		expect(rows.map((r) => [r.name, r.value])).toEqual([
			["0", "7"],
			["1 (top)", "8"],
			["10 (above sp)", "3"],
		]);
		await adapter.request("setVariable", { ref, name: "0", value: "$10" });
		expect(ic.stackAt(0)).toBe(16);
		await adapter.request("continue", {});
		await run;
	});

	it("shows devices by pin, then db, then the network; readings from a pipe can't be edited", async () => {
		const { adapter, run, scope, world } = await stopped();
		const { rows } = await scope("Devices");
		expect(rows.map((r) => [r.name, r.value])).toEqual([
			["d0 → vent", "StructureActiveVent $1001"],
			["db → ic", "StructureCircuitHousing $1003"],
			["pa", "StructurePipeAnalysizer $1002"],
		]);
		const vent = (await adapter.request("variables", { ref: rows[0]!.ref })).variables;
		expect(vent.slice(0, 4).map((r) => [r.name, r.value])).toEqual([
			["id", "$1001 (4097)"],
			["prefab", "StructureActiveVent"],
			["name", "StructureActiveVent"],
			["network", "data"],
		]);
		expect(vent.find((r) => r.name === "On")).toMatchObject({ value: "1", evaluateName: "d0.On" });
		await adapter.request("setVariable", { ref: rows[0]!.ref, name: "On", value: "0" });
		expect(world.device("vent").get("On")).toBe(0);

		const pa = (await adapter.request("variables", { ref: rows[2]!.ref })).variables;
		expect(pa.find((r) => r.name === "Pressure")).toMatchObject({ readOnly: true });
		await expect(adapter.request("setVariable", { ref: rows[2]!.ref, name: "Pressure", value: "1" })).rejects.toThrow(
			/can't be changed here/,
		);
		await adapter.request("continue", {});
		await run;
	});

	it("shows pipes and rooms, the world's time and events, and the script's defines", async () => {
		const { adapter, run, scope } = await stopped();
		const atmospheres = (await scope("Atmospheres")).rows;
		expect(atmospheres[0]).toMatchObject({ name: "coolant" });
		expect(atmospheres[0]!.value).toMatch(/^pipe 100 L: [\d.]+ kPa, 300 K$/);

		const world = (await scope("World")).rows;
		expect(Object.fromEntries(world.map((r) => [r.name, r.value]))).toMatchObject({
			tick: "0",
			time: "0 s",
			"lines this tick": "9 of 128",
			"auto-yields": "0",
			events: "1 to come",
		});
		const events = (await adapter.request("variables", { ref: world.find((r) => r.name === "events")!.ref })).variables;
		expect(events).toEqual([{ name: "dusk", value: "tick 4", ref: 0, readOnly: true }]);

		const defines = (await scope("Defines")).rows;
		expect(defines.map((r) => [r.name, r.value])).toEqual([
			["Stage", "alias r15"],
			["Vent", "alias d0"],
			["Max", "5"],
		]);
		await adapter.request("continue", {});
		await run;
	});

	it("evaluates for hovers, Watch and the Debug Console", async () => {
		const { adapter, run } = await stopped();
		const evaluate = (expression: string, context?: "hover") =>
			adapter.request("evaluate", { thread: 1, expression, ...(context && { context }) });
		expect(await evaluate("Stage")).toEqual({ value: "2", ref: 0 });
		expect(await evaluate("r1")).toEqual({ value: "4097 (→ vent $1001)", ref: 0 });
		expect(await evaluate("Vent.On")).toEqual({ value: "1", ref: 0 });
		const vent = await evaluate("Vent");
		expect(vent.value).toBe("StructureActiveVent $1001");
		expect(vent.ref).toBeGreaterThan(0);
		expect((await evaluate("coolant")).value).toMatch(/^pipe 100 L/);
		expect((await evaluate("Setting", "hover")).value).toMatch(/^Setting: ./);
		await expect(evaluate("nope")).rejects.toThrow(/isn't a register/);
		await adapter.request("continue", {});
		await run;
	});

	it("forgets variable refs when the run carries on", async () => {
		const { adapter, run, scopes } = await stopped();
		await adapter.request("continue", {});
		await run;
		await expect(adapter.request("variables", { ref: scopes[0]!.ref })).rejects.toThrow(/last until the run carries on/);
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
