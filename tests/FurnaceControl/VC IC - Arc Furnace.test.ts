import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/FurnaceControl/VC IC - Arc Furnace.ic10";

/** Arc furnaces on d0 and d2 (d1 left empty), and the furnace room's vent. */
function build() {
	return sim({ root: REPO_ROOT })
		.device("furnace1", "StructureArcFurnace", { Idle: 1 })
		.device("furnace2", "StructureArcFurnace", { Idle: 1, On: 1 })
		.device("vent", "StructureActiveVent", {}, { name: "FurnanceVent" })
		.housing("ic", { file: SCRIPT, pins: { d0: "furnace1", d2: "furnace2" } })
		.build();
}

describe("VC IC - Arc Furnace", () => {
	it("turns on the furnace room's vent, pulling air in", async () => {
		const world = await build();
		await world.runTicks(1);
		expect(world.device("vent")).toHaveProps({ On: 1, Mode: 1 });
	});

	it("starts an idle furnace that has ore waiting, and turns off one with none", async () => {
		const world = await build();
		world.device("furnace1").slot(0).put("ItemIronOre", { Quantity: 10 });
		await world.runTicks(8); // one pin per tick, six pins a pass

		expect(world.device("furnace1")).toHaveProps({ On: 1, Activate: 1 });
		expect(world.device("furnace2")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("leaves a busy furnace that has more ore waiting alone", async () => {
		const world = await build();
		world.device("furnace1").slot(0).put("ItemIronOre", { Quantity: 10 });
		world.device("furnace1").set("Idle", 0).set("On", 1);
		await world.runTicks(8);
		expect(world.device("furnace1")).toHaveProps({ On: 1, Activate: 0 });
	});

	// CODE_REVIEW.md 2.6: switching a furnace off stops its smelt, and the script did that as soon as
	// the furnace had taken the last ore from its import slot.
	it("leaves a furnace that's still smelting on once its import slot empties", async () => {
		const world = await build();
		world.device("furnace1").set("Idle", 0).set("On", 1); // smelting the ore it took in
		await world.runTicks(8);
		expect(world.device("furnace1")).toHaveProps({ On: 1 });

		world.device("furnace1").set("Idle", 1); // done
		await world.runTicks(8);
		expect(world.device("furnace1")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("works the furnaces on d3, d4 and d5 too", async () => {
		const world = await sim({ root: REPO_ROOT })
			.device("furnace4", "StructureArcFurnace", { Idle: 1 })
			.device("furnace5", "StructureArcFurnace", { Idle: 1, On: 1 })
			.device("furnace6", "StructureArcFurnace", { Idle: 1 })
			.housing("ic", { file: SCRIPT, pins: { d3: "furnace4", d4: "furnace5", d5: "furnace6" } })
			.build();
		world.device("furnace4").slot(0).put("ItemIronOre", { Quantity: 10 });
		world.device("furnace6").slot(0).put("ItemCopperOre", { Quantity: 5 });
		await world.runTicks(8);

		expect(world.device("furnace4")).toHaveProps({ On: 1, Activate: 1 });
		expect(world.device("furnace5")).toHaveProps({ On: 0 });
		expect(world.device("furnace6")).toHaveProps({ On: 1, Activate: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("keeps looping, and keeps the vent on, with nothing on any pin", async () => {
		const world = await sim({ root: REPO_ROOT })
			.device("vent", "StructureActiveVent", {}, { name: "FurnanceVent" })
			.housing("ic", { file: SCRIPT })
			.build();
		await world.runTicks(20);

		expect(world.device("vent")).toHaveProps({ On: 1, Mode: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toNeverAutoYield();
	});

	it("turns off an idle furnace on d1 that has nothing to smelt, and doesn't activate it", async () => {
		const world = await sim({ root: REPO_ROOT })
			.device("furnace", "StructureArcFurnace", { Idle: 1, On: 1 })
			.housing("ic", { file: SCRIPT, pins: { d1: "furnace" } })
			.build();
		await world.runTicks(8);

		expect(world.device("furnace")).toHaveProps({ On: 0, Activate: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
