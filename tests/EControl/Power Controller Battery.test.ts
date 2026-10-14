import { describe, expect, it } from "vitest";
import { buildPlant, describeBatteryDisplays, describeCoalGenerator, describeLowCoalWarning, passes } from "./power.ts";

const SCRIPT = "ic10/EControl/Power Controller Battery.ic10";

describe("Power Controller Battery", () => {
	describeCoalGenerator(SCRIPT);
	describeLowCoalWarning(SCRIPT);
	describeBatteryDisplays(SCRIPT);

	// Battery Control's half: the generation, usage and transformer displays, and the transformer.
	it("leaves the transformer and the generation, usage and delta displays alone", async () => {
		const world = await buildPlant(SCRIPT, { coal: [1000], wind: [400], usage: 8000, throttle: 0.1 });
		await passes(world, 3);

		expect(world.device("transformer")).toHaveProps({ Setting: 0 });
		for (const display of ["Power Usage", "Total Power Generation", "Coal Power Generation Sum", "Wind Turbine Generation Sum",
			"Power Delta", "Transformer Output Value"]) {
			expect(world.device(display), display).toHaveProps({ Setting: 0 });
		}
		expect(world.device("TransformerPoweredUp Light")).toHaveProps({ On: 0, Color: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
