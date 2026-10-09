import { describe, expect, it } from "vitest";
import { checkRegister, sim } from "../src/index.ts";

/** A world with one chip running `code`, with a vent on d0. */
function oneChip(code: string, options: Parameters<typeof sim>[0] = {}) {
	return sim({ debug: false, ...options })
		.device("vent", "StructureActiveVent", { PressureOutput: 1000 })
		.housing("ic", { code, pins: { d0: "vent" } })
		.build();
}

/** The message of the assertion `assert` throws. */
function failure(assert: () => void): string {
	try {
		assert();
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("the assertion passed");
}

const COUNTER = "alias Count r3\nloop:\nadd Count Count 1\ns d0 On 1\nyield\nj loop";

describe("toHaveProps", () => {
	it("checks only the properties given, and works on a chip's housing", async () => {
		const world = await oneChip("s d0 Mode 1\ns db Setting 7\nyield");
		await world.runTicks(1);
		expect(world.device("vent")).toHaveProps({ Mode: 1, PressureOutput: 1000 });
		expect(world.device("vent")).toHaveProps({ PressureOutput: expect.closeTo(1000.001, 2) });
		expect(world.device("vent")).not.toHaveProps({ Mode: 0 });
		expect(world.chip("ic")).toHaveProps({ Setting: 7 });
	});

	it("shows each property's verdict, the device and the chips in its report", async () => {
		const world = await oneChip("s d0 Mode 1\nyield");
		await world.runTicks(1);
		const message = failure(() => expect(world.device("vent")).toHaveProps({ Mode: 0, On: 0, Bogus: 1 }));
		expect(message).toContain('expected device "vent" to have { Mode: 0, On: 0, Bogus: 1 }');
		expect(message).toContain("✗ Mode = 1, expected 0");
		expect(message).toContain("✓ On = 0");
		expect(message).toContain("✗ Bogus: StructureActiveVent has no such property");
		expect(message).toMatch(/device vent {2}StructureActiveVent \$1001 on data/);
		expect(message).toMatch(/Mode=1 .*PressureOutput=1000/);
		expect(message).toContain("last 2 lines run:");
	});
});

describe("toHaveRegister / toHaveRegisterCloseTo", () => {
	it("finds registers by alias, raw name, sp and ra", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(3);
		const chip = world.chip("ic");
		expect(chip).toHaveRegister("Count", 3);
		expect(chip).toHaveRegister("r3", 3);
		expect(chip).toHaveRegister("sp", 0);
		expect(chip).not.toHaveRegister("Count", 4);
		expect(chip).toHaveRegisterCloseTo("Count", 3.004);
		expect(chip).not.toHaveRegisterCloseTo("Count", 3.004, 3);
	});

	it("reports the register with its alias, the chip's line, registers, devices and trace", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(3);
		const message = failure(() => expect(world.chip("ic")).toHaveRegister("Count", 5));
		expect(message).toContain('expected chip "ic" register Count (r3) to be 5, but it is 3');
		expect(message).toMatch(/chip "ic" \[<code>\] at tick 3 \(1\.5 s\): at line 5 \("j loop"\), 0 auto-yields/);
		expect(message).toMatch(/r3 +Count +3/);
		expect(message).toContain("(15 other registers are 0)");
		expect(message).toContain("stack: empty (sp 0)");
		expect(message).toMatch(/d0 → vent {2}StructureActiveVent \$1001 on data/);
		expect(message).toMatch(/db → ic {2}StructureCircuitHousing \$1002 on data/);
		expect(message).toMatch(/tick 2 +4 {2}yield {2}<- yield/);
	});

	it("explains an unknown alias, including that aliases are case-sensitive", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(1);
		const message = failure(() => expect(world.chip("ic")).toHaveRegister("count", 1));
		expect(message).toContain('chip "ic" has no register or alias "count" (aliases defined so far: Count)');
		expect(message).toContain("case-sensitive");
	});

	it("labels values that are reference IDs with their device", async () => {
		const world = await oneChip("l r0 d0 ReferenceId\nyield");
		await world.runTicks(1);
		const message = failure(() => expect(world.chip("ic")).toHaveRegister("r0", 1));
		expect(message).toContain("but it is 4097 (→ vent $1001)");
	});

	it("is a plain function underneath", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(2);
		expect(checkRegister(world.chip("ic"), "Count", 2).pass).toBe(true);
		const result = checkRegister(world.chip("ic"), "Count", 9);
		expect(result.pass).toBe(false);
		expect(result.message()).toContain("to be 9, but it is 2");
	});

	it("rejects the wrong kind of subject clearly", async () => {
		const world = await oneChip(COUNTER);
		expect(() => expect(world.device("vent")).toHaveRegister("r0", 0)).toThrow(
			/toHaveRegister: expected a chip, e\.g\. expect\(world\.chip\("ic"\)\), but got device "vent"/,
		);
	});
});

describe("toHaveStack / toHaveStackAt", () => {
	it("compares what's below sp, or one entry", async () => {
		const world = await oneChip("push 4\npush 5\npush 6\npop r0\nyield");
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveStack([4, 5]);
		expect(world.chip("ic")).toHaveStackAt(2, 6); // popped, but still in memory
		expect(world.chip("ic")).not.toHaveStack([4, 5, 6]);
		expect(failure(() => expect(world.chip("ic")).toHaveStack([4]))).toContain(
			'expected chip "ic" to have stack [4], but it has [4, 5]',
		);
		expect(failure(() => expect(world.chip("ic")).toHaveStackAt(0, 9))).toContain("stack (sp 2): [4, 5]");
	});
});

describe("toBeAtLine", () => {
	it("accepts an index or a label", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(1);
		expect(world.chip("ic")).toBeAtLine(5);
		await world.step(1);
		expect(world.chip("ic")).toBeAtLine("loop");
		expect(failure(() => expect(world.chip("ic")).toBeAtLine(4))).toContain(
			'expected chip "ic" to be at line 4 "yield", but it is at line 1 "loop:"',
		);
		expect(failure(() => expect(world.chip("ic")).toBeAtLine("nowhere"))).toContain('chip "ic" has no label "nowhere"');
	});
});

describe("toHaveNoErrors / toHaveHalted", () => {
	it("passes for a clean chip", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(5);
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).not.toHaveHalted();
		expect(failure(() => expect(world.chip("ic")).toHaveHalted())).toContain(
			'expected chip "ic" to have halted, but it is still running',
		);
	});

	it("reports a halt with its line and source", async () => {
		const world = await oneChip("alias Stage r15\nmove Stage 1\nyield\nmove stage 0\nyield");
		await world.runTicks(3);
		const chip = world.chip("ic");
		expect(chip).toHaveHalted();
		expect(chip).toHaveHalted({ line: 3, error: /register/ });
		expect(chip).not.toHaveHalted({ line: 2 });
		expect(chip).not.toHaveNoErrors();

		const message = failure(() => expect(chip).toHaveNoErrors());
		expect(message).toContain('expected chip "ic" to have no errors, but it halted');
		expect(message).toMatch(/line 3 "move stage 0": strong: /);
		expect(message).toMatch(/halted at line 3 \("move stage 0"\) in tick 1/);
		expect(message).toMatch(/r15 +Stage +1/);

		expect(failure(() => expect(chip).toHaveHalted({ line: 1 }))).toContain('it halted at line 3, not 1 "move Stage 1"');
	});

	it("counts warnings by default, and weak errors only when asked", async () => {
		// Reading a property the device doesn't have is a warning; the chip keeps going.
		const world = await oneChip("l r0 d0 Charge\nyield");
		await world.runTicks(1);
		expect(world.chip("ic").halted).toBe(false);
		expect(world.chip("ic")).not.toHaveNoErrors();
		expect(world.chip("ic")).toHaveNoErrors({ severity: "strong" });
		expect(failure(() => expect(world.chip("ic")).toHaveNoErrors())).toMatch(/line 0 "l r0 d0 Charge": warning: /);
	});
});

describe("toOnlyChange", () => {
	it("allows the listed paths, by alias or wildcard, and ignores the housing's LineNumber", async () => {
		const world = await oneChip(COUNTER);
		const before = world.snapshot();
		await world.runTicks(2);
		expect(world).toOnlyChange(["ic.Count", "vent.On"], { since: before });
		expect(world).toOnlyChange(["ic.r3", "vent.*"], { since: before });
		expect(world.diff(before)).toOnlyChange(["ic.r3", "vent.On"]);
		expect(world).not.toOnlyChange(["vent.On"], { since: before });

		const message = failure(() => expect(world).toOnlyChange(["vent.On"], { since: before }));
		expect(message).toContain("expected only vent.On to change, but these did too:\n  ic.r3 (Count): 0 → 2");
		expect(message).toContain("allowed changes:\n  vent.On: unset → 1");
	});

	it("needs a snapshot when given a world", async () => {
		const world = await oneChip(COUNTER);
		expect(() => expect(world).toOnlyChange([])).toThrow(/pass \{ since: snapshot \}/);
	});
});

describe("toToggleAtMost", () => {
	it("counts changes in a recording and shows the timeline", async () => {
		const world = await oneChip("loop:\nseqz r0 r0\ns d0 On r0\nyield\nj loop");
		const on = world.record("vent.On");
		await world.runTicks(6);
		expect(on).toToggleAtMost(6);
		expect(on).not.toToggleAtMost(5);
		const message = failure(() => expect(on).toToggleAtMost(2));
		expect(message).toContain('expected "vent.On" to change at most 2 times, but it changed 6 times over ticks 0–6');
		expect(message).toContain("tick     0: 0\n  tick     1: 1\n  tick     2: 0");
	});
});

describe("toNeverAutoYield / toAutoYieldAtMost", () => {
	it("passes for a loop that yields", async () => {
		const world = await oneChip(COUNTER);
		await world.runTicks(10);
		expect(world.chip("ic")).toNeverAutoYield();
		expect(world.chip("ic")).toAutoYieldAtMost(0, { perTicks: 3 });
	});

	it("reports where a loop without a yield was preempted", async () => {
		const world = await oneChip("loop:\nadd r0 r0 1\nj loop");
		await world.runTicks(4);
		const chip = world.chip("ic");
		expect(chip).not.toNeverAutoYield();
		expect(chip).toAutoYieldAtMost(4);
		expect(chip).toAutoYieldAtMost(2, { perTicks: 2 });
		expect(chip).not.toAutoYieldAtMost(1, { perTicks: 2 });

		const message = failure(() => expect(chip).toNeverAutoYield());
		expect(message).toContain('expected chip "ic" never to auto-yield, but it ran 128 lines without a yield or sleep 4 times in 4 ticks');
		expect(message).toMatch(/preempted:\n {2}after line 1 "add r0 r0 1": 2 times\n {2}after line 0 "loop:": once/);
		expect(message).toContain("in ticks: 0, 1, 2, 3");
		expect(failure(() => expect(chip).toAutoYieldAtMost(1, { perTicks: 2 }))).toContain(
			"to auto-yield at most once per 2 ticks, but it auto-yielded 2 times in ticks 0–1",
		);
	});

});
