import { describe, expect, it } from "vitest";
import { sim } from "../src/index.ts";

describe("device memory", () => {
	it("shows what put wrote into a device's memory", async () => {
		const world = await sim({ debug: false })
			.device("sorter", "StructureLogicSorter")
			.housing("ic", { code: "put d0 0 42\nput d0 3 7\nyield", pins: { d0: "sorter" } })
			.build();
		await world.runTicks(1);
		expect(world.device("sorter").stackAt(0)).toBe(42);
		expect(world.device("sorter").stackAt(3)).toBe(7);
		expect(world.device("sorter").stackAt(1)).toBe(0);
	});

	it("is an error on a device without memory", async () => {
		const world = await sim({ debug: false }).device("vent", "StructureActiveVent").housing("ic", { code: "yield" }).build();
		expect(() => world.device("vent").stackAt(0)).toThrow(/"vent" has no memory/);
	});
});
