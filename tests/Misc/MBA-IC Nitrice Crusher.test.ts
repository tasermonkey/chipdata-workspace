import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** The chip sits in a filtration unit, reading the liquid N2O's pressure on its input; the ice crusher is on d0. */
function build(pressure: number) {
	return sim({ root: REPO_ROOT })
		.device("crusher", "StructureIceCrusher")
		.housing("ic", {
			file: "ic10/Misc/MBA-IC Nitrice Crusher.ic10",
			prefab: "StructureFiltration",
			props: { PressureInput: pressure },
			pins: { d0: "crusher" },
		})
		.build();
}

describe("MBA-IC Nitrice Crusher", () => {
	it("runs the crusher while it has ice and the pressure is fine", async () => {
		const world = await build(1000);
		world.device("crusher").slot(0).put("ItemNitrice");
		await world.runTicks(2);
		expect(world.device("crusher")).toHaveProps({ On: 1, Activate: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("keeps it off with no ice in it", async () => {
		const world = await build(1000);
		await world.runTicks(2);
		expect(world.device("crusher")).toHaveProps({ On: 0 });
	});

	it("stops it above 1,500 kPa, and waits until the pressure is below 500 kPa", async () => {
		const world = await build(1000);
		world.device("crusher").slot(0).put("ItemNitrice");
		await world.runTicks(2);

		world.db("ic").set("PressureInput", 1600);
		await world.runTicks(2);
		expect(world.device("crusher")).toHaveProps({ On: 0 });

		world.db("ic").set("PressureInput", 1000); // between the limits: still waiting
		await world.runTicks(2);
		expect(world.device("crusher")).toHaveProps({ On: 0 });

		world.db("ic").set("PressureInput", 400);
		await world.runTicks(2);
		expect(world.device("crusher")).toHaveProps({ On: 1 });
	});
});
