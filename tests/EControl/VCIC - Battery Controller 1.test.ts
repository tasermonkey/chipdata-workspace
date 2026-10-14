import { describe, expect, it } from "vitest";
import {
	buildPlant,
	describeBatteryDisplays,
	describeCoalGenerator,
	describeGenerationDisplays,
	describeLowCoalWarning,
	describePowerDelta,
	describeTransformer,
	passes,
} from "./power.ts";

// Battery Control and Power Controller Battery in one chip.
const SCRIPT = "ic10/EControl/VCIC - Battery Controller 1.ic10";

describe("VCIC - Battery Controller 1", () => {
	describeCoalGenerator(SCRIPT);
	describeLowCoalWarning(SCRIPT);
	describeBatteryDisplays(SCRIPT);
	describeGenerationDisplays(SCRIPT);
	describePowerDelta(SCRIPT);
	describeTransformer(SCRIPT);

	// CODE_REVIEW.md 3.2: it defines UPRIGHT_WIND_TURB_T but never pushes it.
	it("doesn't count upright wind turbines, though it defines their type", async () => {
		const world = await buildPlant(SCRIPT, { coal: [1000], wind: [400], upright: [700] });
		await passes(world, 2);
		expect(world.device("Wind Turbine Generation Sum")).toHaveProps({ Setting: 400 });
		expect(world.device("Total Power Generation")).toHaveProps({ Setting: 1400 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
