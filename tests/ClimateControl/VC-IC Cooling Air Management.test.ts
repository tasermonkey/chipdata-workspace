import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/VC-IC Cooling Air Management [498974].ic10";

/**
 * The vent's PressureInternal is its configured limit, not a reading; it's set here to something
 * other than the pipe pressure so a script reading the wrong one is caught.
 */
function build(pipe: { temp: number; pressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("vent", "StructureActiveVent", {
			TemperatureOutput: pipe.temp,
			PressureOutput: pipe.pressure,
			PressureInternal: 1000,
		})
		.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent" } })
		.build();
}

const HOT = 450; // above MAX_PIPE_TEMP, 419.15 K
const COOL = 400;

// CODE_REVIEW.md 1.4: it read the vent's PressureInternal setting, and expelled only below 500 kPa.
describe("VC-IC Cooling Air Management", () => {
	it("expels a hot pipe that is well above the 500 kPa floor", async () => {
		const world = await build({ temp: HOT, pressure: 5000 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("keeps at least 500 kPa in the pipe, however hot", async () => {
		const world = await build({ temp: HOT, pressure: 300 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ On: 0 });
	});

	it("leaves a cool pipe alone", async () => {
		const world = await build({ temp: COOL, pressure: 5000 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ On: 0 });
	});
});
