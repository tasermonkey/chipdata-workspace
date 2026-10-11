// A test the attach test debugs: it knows nothing about the debugger.
import { describe, expect, it } from "vitest";
import { sim } from "../../../src/index.ts";

describe("counter", () => {
	it("counts once a tick", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "counter.ic10" }).build();
		await world.runTicks(3);
		expect(world.chip("ic")).toHaveRegister("Count", 3);
	});

	it("is another test, not selected by line", () => {
		throw new Error("this test should have been filtered out");
	});
});
