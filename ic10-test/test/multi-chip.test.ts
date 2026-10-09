/**
 * Several chips on one data network: they take turns within each tick (in declaration order), each
 * running until it yields, sleeps, halts or uses up its 128 lines, and every chip sees the others'
 * writes as soon as they happen.
 */
import { describe, expect, it } from "vitest";
import { sim, type World } from "../src/index.ts";

/** Counts ticks in r0 and writes the count to the vent's PressureExternal. */
const WRITER = "loop:\nadd r0 r0 1\ns d0 PressureExternal r0\nyield\nj loop";
/** Copies the vent's PressureExternal into r0 every tick. */
const READER = "loop:\nl r0 d0 PressureExternal\nyield\nj loop";

/** The (tick, chip) turns taken, in order, from the world's trace. */
function turns(world: World): string[] {
	const out: string[] = [];
	for (const entry of world.scheduler.trace) {
		const turn = `${entry.tick}:${entry.chip}`;
		if (out.at(-1) !== turn) out.push(turn);
	}
	return out;
}

describe("several chips on one network", () => {
	it("a chip sees another's write to a shared device in the same tick, if it runs after it", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("writer", { code: WRITER, pins: { d0: "vent" } })
			.housing("reader", { code: READER, pins: { d0: "vent" } })
			.build();

		for (let tick = 1; tick <= 3; tick++) {
			await world.runTicks(1);
			expect(world.chip("writer")).toHaveRegister("r0", tick);
			expect(world.chip("reader")).toHaveRegister("r0", tick);
		}
	});

	it("a chip that runs first sees another's write one tick later", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("reader", { code: READER, pins: { d0: "vent" } })
			.housing("writer", { code: WRITER, pins: { d0: "vent" } })
			.build();

		for (let tick = 1; tick <= 3; tick++) {
			await world.runTicks(1);
			expect(world.chip("writer")).toHaveRegister("r0", tick);
			expect(world.chip("reader")).toHaveRegister("r0", tick - 1);
		}
	});

	it("when a chip yields, the next chip runs, then the first again next tick", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("a", { code: WRITER, pins: { d0: "vent" } })
			.housing("b", { code: READER, pins: { d0: "vent" } })
			.housing("c", { code: READER, pins: { d0: "vent" } })
			.build();

		await world.runTicks(3);
		expect(turns(world)).toEqual(["0:a", "0:b", "0:c", "1:a", "1:b", "1:c", "2:a", "2:b", "2:c"]);
	});

	it("a chip preempted after 128 lines lets the others run, and resumes where it was next tick", async () => {
		// No yield: a 4-line pass (label included), so 32 passes per tick.
		const busy = "loop:\nadd r0 r0 1\ns d0 PressureExternal r0\nj loop";
		const world = await sim({ debug: false, traceLength: 1000 }) // keep both ticks' lines for turns()
			.device("vent", "StructureActiveVent")
			.housing("busy", { code: busy, pins: { d0: "vent" } })
			.housing("reader", { code: READER, pins: { d0: "vent" } })
			.build();

		await world.runTicks(1);
		expect(world.chip("busy")).toHaveRegister("r0", 32);
		expect(world.chip("busy")).toAutoYieldAtMost(1);
		expect(world.chip("reader")).toHaveRegister("r0", 32); // ran after the preemption, same tick

		await world.runTicks(1);
		expect(world.chip("busy")).toHaveRegister("r0", 64);
		expect(world.chip("reader")).toHaveRegister("r0", 64);
		expect(turns(world)).toEqual(["0:busy", "0:reader", "1:busy", "1:reader"]);
		expect(world.chip("reader")).toNeverAutoYield();
	});

	it("a sleeping chip doesn't hold up the others", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("sleeper", { code: "loop:\nadd r1 r1 1\nsleep 2\nj loop" })
			.housing("writer", { code: WRITER, pins: { d0: "vent" } })
			.build();

		await world.runTicks(4); // 2 s: the sleeper wakes at the start of tick 4
		expect(world.chip("sleeper")).toHaveRegister("r1", 1);
		expect(world.chip("sleeper").sleeping).toBe(true);
		expect(world.chip("writer")).toHaveRegister("r0", 4);

		await world.runTicks(1);
		expect(world.chip("sleeper")).toHaveRegister("r1", 2);
		expect(world.chip("writer")).toHaveRegister("r0", 5);
	});

	it("a chip that halts doesn't stop the others, and what it wrote stays", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("faulty", { code: "s d0 On 1\nyield\nmove nowhere 0", pins: { d0: "vent" } })
			.housing("reader", { code: "loop:\nadd r1 r1 1\nl r0 d0 On\nyield\nj loop", pins: { d0: "vent" } })
			.build();

		await world.runTicks(5);
		expect(world.chip("faulty")).toHaveHalted({ line: 2 });
		expect(world.chip("reader")).toHaveNoErrors();
		expect(world.chip("reader")).toHaveRegister("r1", 5);
		expect(world.chip("reader")).toHaveRegister("r0", 1);
	});

	it("a third device written by one chip is seen by another through a pin, its ID, a batch and its name", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent", {}, { id: "$1488", name: "Hangar Vent" })
			.housing("writer", { code: "sd $1488 Mode 1\ns d0 On 1\nyield", pins: { d0: "vent" } })
			.housing("reader", {
				code: [
					"l r0 d0 Mode",
					"ld r1 $1488 On",
					'lb r2 HASH("StructureActiveVent") Mode Maximum',
					'lbn r3 HASH("StructureActiveVent") HASH("Hangar Vent") On Maximum',
					"yield",
				].join("\n"),
				pins: { d0: "vent" },
			})
			.build();

		await world.runTicks(1);
		expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
		for (const reg of ["r0", "r1", "r2", "r3"]) expect(world.chip("reader")).toHaveRegister(reg, 1);
		expect(world.chip("reader")).toHaveNoErrors();
	});

	it("chips talk through each other's housing and stack", async () => {
		// "a" sends a number into b's stack slot 0 each tick; "b" doubles it onto its own db Setting;
		// "a" reads that back from b's housing on its next turn.
		const world = await sim({ debug: false })
			.housing("a", {
				code: "loop:\nadd r0 r0 1\nput d0 0 r0\nl r1 d0 Setting\nyield\nj loop",
				pins: { d0: "b" },
			})
			.housing("b", { code: "loop:\nget r0 db 0\nmul r0 r0 2\ns db Setting r0\nyield\nj loop" })
			.build();

		await world.runTicks(1);
		expect(world.chip("b")).toHaveStackAt(0, 1);
		expect(world.chip("b")).toHaveProps({ Setting: 2 });
		expect(world.chip("a")).toHaveRegister("r1", 0); // read before b's turn

		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r1", 2); // b's answer from the last tick
		expect(world.chip("b")).toHaveProps({ Setting: 4 });
	});

	it("scripted events change the world before any chip's turn", async () => {
		const world = await sim({ debug: false })
			.device("vent", "StructureActiveVent")
			.housing("a", { code: READER, pins: { d0: "vent" } })
			.housing("b", { code: READER, pins: { d0: "vent" } })
			.build();
		world.at({ tick: 2 }, (w) => w.device("vent").set("PressureExternal", 99));

		await world.runTicks(2);
		expect(world.chip("a")).toHaveRegister("r0", 0);
		await world.runTicks(1);
		expect(world.chip("a")).toHaveRegister("r0", 99);
		expect(world.chip("b")).toHaveRegister("r0", 99);
	});
});

describe("switching a housing off and on", () => {
	/** Counts its starts in r2 (line 0 runs once per start) and its ticks in r0. */
	const WORKER = "add r2 r2 1\nloop:\nadd r0 r0 1\nyield\nj loop";

	it("one chip restarts another by switching its housing off, yielding, and on again", async () => {
		const world = await sim({ debug: false })
			.housing("controller", {
				code: "yield\nyield\ns d0 On 0\nyield\ns d0 On 1\nloop:\nyield\nj loop",
				pins: { d0: "worker" },
			})
			.housing("worker", { code: WORKER })
			.build();

		await world.runTicks(2);
		expect(world.chip("worker")).toHaveRegister("r2", 1);
		expect(world.chip("worker")).toHaveRegister("r0", 2);

		await world.runTicks(1); // tick 2: switched off before the worker's turn
		expect(world.chip("worker").switchedOff).toBe(true);
		expect(world.chip("worker")).toHaveRegister("r0", 2);
		expect(world.chip("worker").status).toContain("switched off (housing On = 0)");

		await world.runTicks(1); // tick 3: back on, so it starts again from line 0
		expect(world.chip("worker").restarts).toEqual([3]);
		expect(world.chip("worker")).toHaveRegister("r2", 2);
		expect(world.chip("worker")).toHaveRegister("r0", 3); // registers survive by default
		expect(world.chip("worker")).toHaveNoErrors();
	});

	it("switching off and on again within one turn goes unnoticed", async () => {
		const world = await sim({ debug: false })
			.housing("controller", { code: "loop:\ns d0 On 0\ns d0 On 1\nyield\nj loop", pins: { d0: "worker" } })
			.housing("worker", { code: WORKER })
			.build();

		await world.runTicks(3);
		expect(world.chip("worker").restarts).toEqual([]);
		expect(world.chip("worker")).toHaveRegister("r2", 1);
		expect(world.chip("worker")).toHaveRegister("r0", 3);
	});

	it("a halted chip starts over from line 0, with the housing's Error cleared", async () => {
		const world = await sim({ debug: false })
			.housing("ic", { code: "add r2 r2 1\nyield\nmove nowhere 0" })
			.build();
		await world.runTicks(2);
		expect(world.chip("ic")).toHaveHalted({ line: 2 });
		expect(world.db("ic")).toHaveProps({ Error: 1 });

		world.device("ic").set("On", 0);
		await world.runTicks(1);
		world.device("ic").set("On", 1);
		await world.runTicks(1);

		expect(world.chip("ic")).not.toHaveHalted();
		expect(world.chip("ic")).toBeAtLine(2); // ran line 0, yielded on line 1
		expect(world.chip("ic")).toHaveRegister("r2", 2);
		expect(world.db("ic")).toHaveProps({ Error: 0, On: 1 });

		await world.runTicks(1);
		expect(world.chip("ic")).toHaveHalted({ line: 2 }); // the same bug, again
		expect(world.chip("ic").errors).toHaveLength(2); // both halts are in the history
	});

	it("defines and aliases are rebuilt on a restart rather than clashing", async () => {
		const world = await sim({ debug: false })
			.housing("ic", { code: "define LIMIT 5\nalias Count r3\nloop:\nadd Count Count 1\nyield\nj loop" })
			.build();
		await world.runTicks(2);
		world.device("ic").set("On", 0);
		await world.runTicks(1);
		world.device("ic").set("On", 1);
		await world.runTicks(1);

		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toHaveRegister("Count", 3);
	});

	it("restartClearsState also clears registers and the stack", async () => {
		const world = await sim({ debug: false, restartClearsState: true })
			.housing("ic", { code: "push 7\nloop:\nadd r0 r0 1\nyield\nj loop" })
			.build();
		await world.runTicks(3);
		expect(world.chip("ic")).toHaveRegister("r0", 3);

		world.device("ic").set("On", 0);
		await world.runTicks(1);
		world.device("ic").set("On", 1);
		await world.runTicks(1);

		expect(world.chip("ic")).toHaveRegister("r0", 1);
		expect(world.chip("ic")).toHaveStack([7]); // pushed again after the restart
		expect(world.chip("ic")).toHaveStackAt(1, 0);
	});

	it("housings start switched on, unless built with On: 0", async () => {
		const world = await sim({ debug: false })
			.housing("on", { code: WORKER })
			.housing("off", { code: WORKER, props: { On: 0 } })
			.build();
		await world.runTicks(2);
		expect(world.db("on")).toHaveProps({ On: 1 });
		expect(world.chip("on")).toHaveRegister("r0", 2);
		expect(world.chip("off")).toHaveRegister("r0", 0);

		world.device("off").set("On", 1);
		await world.runTicks(1);
		expect(world.chip("off")).toHaveRegister("r0", 1);
	});
});
