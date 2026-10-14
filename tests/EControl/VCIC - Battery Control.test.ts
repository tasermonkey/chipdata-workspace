import { describe, expect, it } from "vitest";
import { buildPlant, describeGenerationDisplays, describePowerDelta, describeTransformer, passes } from "./power.ts";

const SCRIPT = "ic10/EControl/VCIC - Battery Control.ic10";

describe("VCIC - Battery Control", () => {
	describeGenerationDisplays(SCRIPT);
	describePowerDelta(SCRIPT);
	describeTransformer(SCRIPT);

	// Power Controller Battery's half: the coal generators, the battery displays and the low coal light.
	it("leaves the coal generators, the battery displays and the Low Coal light alone", async () => {
		const world = await buildPlant(SCRIPT, { ratio: 0.01, charge: 12345, coal: [1000], coalOn: 0 });
		await passes(world, 3);

		expect(world.device("coal0")).toHaveProps({ On: 0 }); // the battery is nearly flat
		for (const display of ["Battery Charge Per", "Battery Storage Gauge", "Stored Power Display"]) {
			expect(world.device(display), display).toHaveProps({ Setting: 0, Color: 0 });
		}
		expect(world.device("Low Coal")).toHaveProps({ On: 0, Color: 0 }); // the chute marker is empty
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
