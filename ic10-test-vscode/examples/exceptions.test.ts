// Halts and automatic yields as exception stops: see halts.ic10 and auto-yields.ic10.
import { sim } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

describe("exceptions", () => {
	it("halts reading a logic type the housing doesn't have", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "halts.ic10" }).build();
		await world.runTicks(5);
		expect(world.chip("ic")).toHaveHalted({ line: 8, error: /Temperature/ });
		expect(world.chip("ic")).toHaveRegister("Counter", 3);
	});

	it("auto-yields once a tick in a loop with no yield", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "auto-yields.ic10" }).build();
		await world.runTicks(2);
		expect(world.chip("ic").autoYields).toBe(2);
	});
});
