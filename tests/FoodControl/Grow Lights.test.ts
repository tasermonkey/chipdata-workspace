import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** A daylight sensor on d0 and two grow lights on the network. */
function build(vertical: number) {
	return sim({ root: REPO_ROOT })
		.device("sensor", "StructureDaylightSensor", { Vertical: vertical })
		.device("light1", "StructureGrowLight")
		.device("light2", "StructureGrowLight")
		.housing("ic", { file: "ic10/FoodControl/Grow Lights.ic10", pins: { d0: "sensor" } })
		.build();
}

describe("Grow Lights", () => {
	it("turns every grow light on while the sun's vertical angle is 100 or less", async () => {
		const world = await build(100);
		await world.runTicks(1);
		expect(world.device("light1")).toHaveProps({ On: 1 });
		expect(world.device("light2")).toHaveProps({ On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns them off above 100, and on again when it drops", async () => {
		const world = await build(101);
		await world.runTicks(1);
		expect(world.device("light1")).toHaveProps({ On: 0 });

		world.device("sensor").set("Vertical", 60);
		await world.runSeconds(2); // it checks about once every 1.5 s
		expect(world.device("light1")).toHaveProps({ On: 1 });
		expect(world.device("light2")).toHaveProps({ On: 1 });
	});
});
