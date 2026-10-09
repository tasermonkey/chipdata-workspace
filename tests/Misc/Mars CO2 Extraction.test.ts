import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

describe("Mars CO2 Extraction", () => {
	it("sets the two named vents' pressure limits once, and ends", async () => {
		const world = await sim({ root: REPO_ROOT })
			.device("keepCool", "StructureActiveVent", {}, { name: "Vent KeepCO2Cool" })
			.device("eject", "StructureActiveVent", {}, { name: "Vent EjectCooledAir" })
			.device("other", "StructureActiveVent", { PressureInternal: 101 })
			.housing("ic", { file: "ic10/Misc/Mars CO2 Extraction.ic10" })
			.build();
		await world.runToHalt({ maxTicks: 1 });

		expect(world.device("keepCool")).toHaveProps({ PressureInternal: 250 });
		expect(world.device("eject")).toHaveProps({ PressureInternal: 200 });
		expect(world.device("other")).toHaveProps({ PressureInternal: 101 });
		expect(world.chip("ic").ended).toBe(true);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
