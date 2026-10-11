// Breakpoints, conditional breakpoints and logpoints: see breakpoints.ic10 for what to try.
import { sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

describe("breakpoints", () => {
	it("counts once a tick", async () => {
		const world = await sim({ root: import.meta.dirname }).housing("ic", { file: "breakpoints.ic10" }).build();
		await world.runTicks(10);
		expect(world.chip("ic")).toHaveRegister("Counter", 10);
		expect(world.chip("ic")).toHaveProps({ Setting: 20 });
	});
});
