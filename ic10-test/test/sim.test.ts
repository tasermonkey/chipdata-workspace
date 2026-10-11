import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DebugGate, SimBudgetError, SimHaltError, SimRunError, sim } from "../src/index.ts";

/** A world with one chip running `code`, pinned to nothing. */
function oneChip(code: string, options: Parameters<typeof sim>[0] = {}) {
	return sim({ debug: false, ...options })
		.housing("ic", { code })
		.build();
}

const COUNTER = "loop:\nadd r0 r0 1\nyield\nj loop";

describe("sim() builder", () => {
	it("gives devices deterministic reference IDs, or the ones asked for", async () => {
		const world = await sim()
			.device("a", "StructureWallLight")
			.device("lathe", "StructureAutolathe", {}, { id: "$1488" })
			.device("b", "StructureWallLight", {}, { id: 0x1001 + 1 })
			.housing("ic", { code: "yield" })
			.build();
		expect(world.device("a").id).toBe(0x1001);
		expect(world.device("lathe").idHex).toBe("$1488");
		expect(world.device("b").id).toBe(0x1002);
		expect(world.device("ic").id).toBe(0x1003); // skips the one taken by "b"
	});

	it("sets ReferenceId and PrefabHash where the device has them", async () => {
		const world = await sim()
			.device("vent", "StructureActiveVent")
			.housing("ic", { code: "l r0 d0 ReferenceId\nl r1 db ReferenceId\nyield", pins: { d0: "vent" } })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic").reg("r0")).toBe(world.device("vent").id);
		expect(world.chip("ic").reg("r1")).toBe(world.device("ic").id);
	});

	it("resolves ld / sd by reference ID in the game's $hex form", async () => {
		const world = await sim()
			.device("lathe", "StructureAutolathe", {}, { id: "$1488" })
			.housing("ic", { code: "ld r0 $1488 ReferenceId\nsd $1488 On 1\nyield" })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic").reg("r0")).toBe(0x1488);
		expect(world.device("lathe").get("On")).toBe(1);
	});

	it("uses in-game names for sbn", async () => {
		const world = await sim()
			.device("lamp", "StructureWallLight", {}, { name: "Lamp" })
			.device("other", "StructureWallLight", {}, { name: "Other" })
			.housing("ic", { code: 'sbn HASH("StructureWallLight") HASH("Lamp") On 1\nyield' })
			.build();
		await world.runTicks(1);
		expect(world.device("lamp").get("On")).toBe(1);
		expect(world.device("other").get("On")).toBe(0);
		expect(world.network("data").byName("Lamp").map((d) => d.key)).toEqual(["lamp"]);
		expect(world.network("data").byType("StructureWallLight")).toHaveLength(2);
	});

	it("loads a program from a file relative to root, normalising CRLF", async () => {
		const root = mkdtempSync(join(tmpdir(), "ic10-test-"));
		writeFileSync(join(root, "x.ic10"), "move r0 7\r\nyield\r\n");
		const world = await sim({ root }).housing("ic", { file: "x.ic10" }).build();
		await world.runTicks(1);
		expect(world.chip("ic").reg("r0")).toBe(7);
		expect(world.chip("ic").source).toBe("x.ic10");
	});

	it("sets the housing's own properties", async () => {
		const world = await sim()
			.housing("ic", { code: "l r0 db Setting\nyield", props: { Setting: 42 } })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic").reg("r0")).toBe(42);
	});

	it.each([
		["both file and code", () => sim().housing("ic", { code: "", file: "x.ic10" }), /exactly one/],
		["neither file nor code", () => sim().housing("ic", {}), /exactly one/],
		["a duplicate key", () => sim().device("a", "StructureWallLight").device("a", "StructureWallLight"), /twice/],
		[
			"a duplicate reference ID",
			() =>
				sim()
					.device("a", "StructureWallLight", {}, { id: 5 })
					.device("b", "StructureWallLight", {}, { id: "$5" }),
			/same reference ID/,
		],
		["a pin to an unknown device", () => sim().housing("ic", { code: "", pins: { d0: "nope" } }), /no device "nope"/],
		[
			"no network with several",
			() => sim().network("a").network("b").device("x", "StructureWallLight", {}, { network: "a" }).housing("ic", { code: "" }),
			/several networks/,
		],
		// @ts-expect-error The types reject it too.
		["an unknown property", () => sim().device("x", "StructureWallLight", { Bogus: 1 }), /rejected/],
		["a line that doesn't parse", () => sim().housing("ic", { code: "move r0 1\n%%%" }), /"ic" line 1/],
	])("rejects %s", async (_what, declare, error) => {
		await expect(declare().build()).rejects.toThrow(error);
	});
});

describe("ticks", () => {
	it("a yield ends the chip's tick", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(5);
		expect(world.chip("ic").reg("r0")).toBe(5);
		expect(world.tick).toBe(5);
		expect(world.time).toBe(2.5);
		expect(world.chip("ic").autoYields).toBe(0);
	});

	it("auto-yields after 128 lines, counting label lines", async () => {
		const world = await oneChip("loop:\nadd r0 r0 1\nj loop");
		await world.runTicks(1);
		// 128 lines = 42 passes of 3 lines, then "loop:" and "add".
		expect(world.chip("ic").reg("r0")).toBe(43);
		expect(world.chip("ic").autoYields).toBe(1);
		expect(world.chip("ic").line).toBe(2); // resumes at "j loop"
	});

	it("can count only instruction lines", async () => {
		const world = await oneChip("loop:\nadd r0 r0 1\nj loop", { countNonInstructionLines: false });
		await world.runTicks(1);
		expect(world.chip("ic").reg("r0")).toBe(64);
	});

	it("takes linesPerTick per world or per chip", async () => {
		const world = await sim({ linesPerTick: 10, debug: false })
			.housing("a", { code: "loop:\nadd r0 r0 1\nj loop" })
			.housing("b", { code: "loop:\nadd r0 r0 1\nj loop", linesPerTick: 4 })
			.build();
		await world.runTicks(1);
		expect(world.chip("a").linesExecuted).toBe(10);
		expect(world.chip("b").linesExecuted).toBe(4);
	});

	it("runs chips in declaration order within a tick", async () => {
		const world = await sim({ debug: false })
			.housing("writer", { code: "loop:\nadd r0 r0 1\ns d0 Setting r0\nyield\nj loop", pins: { d0: "reader" } })
			.housing("reader", { code: "loop:\nl r0 db Setting\nyield\nj loop" })
			.build();
		await world.runTicks(1);
		expect(world.chip("reader").reg("r0")).toBe(1); // saw the writer's value from the same tick
	});

	it("parks a sleeping chip for its game time, with no real delay", async () => {
		const world = await oneChip("sleep 5\nmove r0 1\nloop:\nyield\nj loop");
		const start = performance.now();
		await world.runTicks(10);
		expect(world.chip("ic").sleeping).toBe(true);
		expect(world.chip("ic").reg("r0")).toBe(0);
		await world.runTicks(1); // tick 10 starts at 5 s
		expect(world.chip("ic").reg("r0")).toBe(1);
		expect(world.chip("ic").sleeping).toBe(false);
		expect(performance.now() - start).toBeLessThan(1000);
	});

	it("treats sleep 0 as a yield", async () => {
		const world = await oneChip("loop:\nadd r0 r0 1\nsleep 0\nj loop");
		await world.runTicks(3);
		expect(world.chip("ic").reg("r0")).toBe(3);
	});

	it("runSeconds rounds up to whole ticks", async () => {
		const world = await oneChip(COUNTER);
		await world.runSeconds(1.2);
		expect(world.tick).toBe(3);
	});

	it("step() runs lines ignoring ticks", async () => {
		const world = await oneChip("move r0 1\nyield\nmove r0 2\nsleep 10\nmove r0 3");
		await world.step(5);
		expect(world.chip("ic").reg("r0")).toBe(3);
		expect(world.tick).toBe(0);
	});
});

describe("halting", () => {
	const BAD = "alias Stage r15\nmove Stage 1\nmove stage 0\nmove r0 9\nyield";

	it("halts the chip on a strong error, as the game does", async () => {
		const world = await oneChip(BAD);
		await world.runTicks(3);
		const chip = world.chip("ic");
		expect(chip.halted).toBe(true);
		expect(chip.halt?.line).toBe(2);
		expect(chip.halt?.tick).toBe(0);
		expect(chip.line).toBe(2);
		expect(chip.reg("r0")).toBe(0); // the next line never ran
		expect(chip.reg("Stage")).toBe(1);
		expect(world.db("ic").get("Error")).toBe(1);
	});

	it("can fail the test on any halt", async () => {
		const world = await oneChip(BAD, { failOnHalt: true });
		const run = world.runTicks(1);
		await expect(run).rejects.toThrow(SimHaltError);
		await expect(run).rejects.toThrow(/halted at line 2 \("move stage 0"\)/);
	});

	it("marks a chip that runs off the end as ended, not halted", async () => {
		const world = await oneChip("move r0 1\nmove r1 2");
		await world.chip("ic").runToHalt();
		expect(world.chip("ic").ended).toBe(true);
		expect(world.chip("ic").halted).toBe(false);
		expect(world.chip("ic").reg("r1")).toBe(2);
		expect(world.tick).toBe(1);
	});
});

describe("budgets", () => {
	it("an endless runUntil fails fast, with a trace", async () => {
		const world = await oneChip(COUNTER);
		const start = performance.now();
		const run = world.runUntil(() => false);
		await expect(run).rejects.toThrow(SimBudgetError);
		await expect(run).rejects.toThrow(/still false after 10000 ticks \(maxTicks\)/);
		await expect(run).rejects.toThrow(/last 20 lines run:[\s\S]*yield {2}<- yield/);
		expect(performance.now() - start).toBeLessThan(2000);
	});

	it("maxTicks can be set per call", async () => {
		const world = await oneChip(COUNTER);
		await expect(world.runUntil(() => false, { maxTicks: 3 })).rejects.toThrow(/after 3 ticks/);
		expect(world.tick).toBe(3);
	});

	it("runUntil stops as soon as the condition holds", async () => {
		const world = await oneChip(COUNTER);
		await world.runUntil((w) => w.chip("ic").reg("r0") >= 7);
		expect(world.tick).toBe(7);
	});

	it("runUntil fails at once when nothing can change", async () => {
		const world = await oneChip("move r0 1");
		await expect(world.runUntil(() => false)).rejects.toThrow(SimRunError);
		expect(world.tick).toBeLessThan(5);
	});

	it("maxLinesPerRun bounds one call", async () => {
		const world = await oneChip("loop:\nadd r0 r0 1\nj loop", { maxLinesPerRun: 1000 });
		await expect(world.runTicks(100)).rejects.toThrow(/more than 1000 lines in one call \(maxLinesPerRun\)/);
	});

	it("one run at a time", async () => {
		const world = await oneChip(COUNTER);
		const first = world.runTicks(5);
		await expect(world.runTicks(1)).rejects.toThrow(/already in progress/);
		await first;
	});
});

describe("runUntilLine", () => {
	it("stops before a label, mid-tick, and carries on from there", async () => {
		const world = await oneChip("move r0 0\nloop:\nadd r0 r0 1\nyield\nj loop");
		await world.runUntilLine("loop");
		expect(world.chip("ic").line).toBe(1);
		expect(world.tick).toBe(0);

		await world.runUntilLine("loop"); // already there: runs until it comes back
		expect(world.chip("ic").reg("r0")).toBe(1);
		expect(world.chip("ic").line).toBe(1);
		expect(world.tick).toBe(1);

		await world.runTicks(1); // finishes tick 1
		expect(world.chip("ic").reg("r0")).toBe(2);
		expect(world.tick).toBe(2);
	});

	it("fails if the chip stops first", async () => {
		const world = await oneChip("move r0 1\nlater:\nyield");
		await world.step(3);
		await expect(world.runUntilLine("later")).rejects.toThrow(/stopped before reaching line 1/);
	});

	it("rejects unknown lines and labels", async () => {
		const world = await oneChip(COUNTER);
		await expect(world.runUntilLine(99)).rejects.toThrow(/no line 99/);
		await expect(world.runUntilLine("nope")).rejects.toThrow(/no label "nope"/);
	});
});

describe("chips", () => {
	it("reads registers by alias, and lists the aliases", async () => {
		const world = await oneChip("alias Stage r15\nmove Stage 3\npush 10\npush 20\nyield");
		await world.runTicks(1);
		const chip = world.chip("ic");
		expect(chip.reg("Stage")).toBe(3);
		expect(chip.reg("r15")).toBe(3);
		expect(chip.aliases()).toMatchObject({ r15: ["Stage"] });
		expect(chip.stack()).toEqual([10, 20]);
		expect(chip.sp).toBe(2);
		expect(() => chip.reg("Nope")).toThrow(/aliases so far: .*Stage/);
		chip.setReg("Stage", 9);
		expect(chip.reg("r15")).toBe(9);
	});
});

describe("scripted events", () => {
	const READER = "loop:\nl r0 d0 Temperature\nyield\nj loop";
	const withSensor = () =>
		sim({ debug: false })
			.device("sensor", "StructureGasSensor", { Temperature: 300 })
			.housing("ic", { code: READER, pins: { d0: "sensor" } })
			.build();

	it("at() changes the world before the tick's chips run; record() samples every tick", async () => {
		const world = await withSensor();
		world.at({ tick: 2 }, (w) => w.device("sensor").set("Temperature", 400));
		const r0 = world.record("ic.r0");
		await world.runTicks(4);
		expect(r0.values).toEqual([0, 300, 300, 400, 400]);
		expect(r0.ticks).toEqual([0, 1, 2, 3, 4]);
		expect(r0.changes).toBe(2);
	});

	it("at() takes seconds, and refuses a tick that has started", async () => {
		const world = await withSensor();
		await world.runTicks(2);
		expect(() => world.at({ tick: 1 }, () => {})).toThrow(/already started/);
		world.at({ seconds: 1.5 }, (w) => w.device("sensor").set("Temperature", 1));
		await world.runTicks(2);
		expect(world.chip("ic").reg("r0")).toBe(1);
	});

	it("every() repeats, and can be cancelled", async () => {
		const world = await withSensor();
		const cancel = world.every({ ticks: 2 }, (w) => {
			w.device("sensor").add("Temperature", 1);
		});
		await world.runTicks(5); // fires at ticks 2 and 4
		expect(world.device("sensor").get("Temperature")).toBe(302);
		cancel();
		await world.runTicks(4);
		expect(world.device("sensor").get("Temperature")).toBe(302);
	});

	it("when() fires each time its condition becomes true", async () => {
		const world = await withSensor();
		let fired = 0;
		world.when(
			(w) => w.device("sensor").get("Temperature") > 350,
			() => {
				fired++;
			},
		);
		world.at({ tick: 1 }, (w) => w.device("sensor").set("Temperature", 400));
		world.at({ tick: 3 }, (w) => w.device("sensor").set("Temperature", 300));
		world.at({ tick: 5 }, (w) => w.device("sensor").set("Temperature", 400));
		await world.runTicks(8);
		expect(fired).toBe(2);
	});
});

describe("snapshots", () => {
	it("diff() lists exactly what changed", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("ic", { code: "s d0 On 1\nmove r3 5\nyield", pins: { d0: "vent" } })
			.build();
		const before = world.snapshot();
		await world.runTicks(1);
		expect(world.diff(before).filter((c) => c.path !== "ic.LineNumber")).toEqual([
			{ path: "ic.r3", from: 0, to: 5 },
			{ path: "vent.On", from: undefined, to: 1 },
		]);
	});
});

describe("debug gate", () => {
	it("is consulted before every line and can pause the chip", async () => {
		let release!: () => void;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const seen: string[] = [];
		const gate: DebugGate = {
			async beforeLine(info) {
				seen.push(`${info.chip}:${info.line}:${info.text}`);
				if (info.line === 1) await paused;
			},
		};
		const world = await sim({ debug: gate }).housing("ic", { code: "move r0 1\nmove r1 2\nyield" }).build();
		const run = world.runTicks(1);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(world.chip("ic").reg("r0")).toBe(1);
		expect(world.chip("ic").reg("r1")).toBe(0); // paused before line 1
		release();
		await run;
		expect(world.chip("ic").reg("r1")).toBe(2);
		expect(seen).toEqual(["ic:0:move r0 1", "ic:1:move r1 2", "ic:2:yield"]);
	});

	it("hears about halts, auto-yields and ticks", async () => {
		const events: string[] = [];
		const gate: DebugGate = {
			onHalt: (i) => void events.push(`halt ${i.line}`),
			onAutoYield: (i) => void events.push(`auto-yield ${i.line}`),
			onTick: (i) => void events.push(`tick ${i.tick}`),
		};
		const world = await sim({ debug: gate, linesPerTick: 2 })
			.housing("ic", { code: "move r0 1\nmove r0 2\nmove r0 3\nmove x 0" })
			.build();
		await world.runTicks(2);
		expect(events).toEqual(["auto-yield 1", "tick 1", "halt 3", "tick 2"]);
	});
});
