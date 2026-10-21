import { describe, expect, it } from "vitest";
import { VentMode } from "@tasermonkey/ic10-bench";
import { build, type Consoles, defines, lever, type RackSetup } from "./rack.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Box.ic10";
const { BOX_AIR, VENT_MAX } = defines(SCRIPT);

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["box"] });

for (const consoles of ["vanilla", "modular"] as const satisfies readonly Consoles[]) {
	describe(`Furnace Box (DS-8), ${consoles} lever`, () => {
		it(`holds the box at ${BOX_AIR} kPa: one vent fills it, the other empties it`, async () => {
			const world = await fit({ consoles });
			await world.runTicks(2);
			expect(world.device("ventOut")).toHaveProps({ On: 1, Mode: VentMode.Outward, PressureExternal: BOX_AIR, PressureInternal: 0 });
			expect(world.device("ventIn")).toHaveProps({ On: 1, Mode: VentMode.Inward, PressureExternal: BOX_AIR, PressureInternal: VENT_MAX });
			expect(world.chip("box")).toHaveNoErrors();
		});

		it("stops both vents with the lever, and starts them again", async () => {
			const world = await fit({ consoles });
			lever(world, "ventLever", true);
			await world.runTicks(2);
			expect(world.device("ventOut")).toHaveProps({ PressureExternal: 0 });
			expect(world.device("ventIn")).toHaveProps({ PressureExternal: 0 });

			lever(world, "ventLever", false);
			await world.runTicks(2);
			expect(world.device("ventOut")).toHaveProps({ PressureExternal: BOX_AIR });
		});
	});
}

describe(SCRIPT, () => {
	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["ventIn"] });
		await world.runTicks(5);
		expect(world.chip("box")).toHaveNoErrors();
		expect(world.chip("box")).toNeverAutoYield();
	});
});
