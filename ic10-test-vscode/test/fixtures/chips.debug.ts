// Tests the adapter tests debug. They know nothing about the debugger.
import { sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

describe("chips", () => {
	it("counts once a tick", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "counter.ic10" }).build();
		await world.runTicks(3);
		expect(world.chip("ic")).toHaveRegister("Count", 3);
	});

	it("counts on through dusk", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "counter.ic10" }).build();
		world.at({ tick: 3 }, () => {}, { label: "dusk" });
		await world.runTicks(6);
		expect(world.chip("ic")).toHaveRegister("Count", 6);
	});

	it("makes nested and recursive calls", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "calls.ic10" }).build();
		await world.runTicks(2);
		expect(world.chip("ic")).toHaveRegister("Result", 11);
		expect(world.chip("ic").sp).toBe(0);
	});

	it("halts on a bad register", async () => {
		const world = await sim().housing("bad", { code: "move r0 1\nmove x 0" }).build();
		await world.runTicks(1);
		expect(world.chip("bad").halted).toBe(true);
	});
});
