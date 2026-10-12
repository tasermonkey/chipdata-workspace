// Step Over, Step Into, Step Out and the Call Stack: see stepping.ic10 for what to try.
import { sim } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

describe("stepping", () => {
	it("makes nested and recursive calls", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "stepping.ic10" }).build();
		await world.runTicks(2);
		expect(world.chip("ic")).toHaveRegister("Result", 11);
		expect(world.chip("ic")).toHaveRegister("Depth", 0);
		expect(world.chip("ic").sp).toBe(0); // every push ra was popped
	});
});
