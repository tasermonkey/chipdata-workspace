import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** Arc furnaces on d0 and d2 (d1 left empty), and the furnace room's vent. */
function build() {
	return sim({ root: REPO_ROOT })
		.device("furnace1", "StructureArcFurnace", { Idle: 1 })
		.device("furnace2", "StructureArcFurnace", { Idle: 1, On: 1 })
		.device("vent", "StructureActiveVent", {}, { name: "FurnanceVent" })
		.housing("ic", { file: "ic10/FurnaceControl/VC IC - Arc Furnace.ic10", pins: { d0: "furnace1", d2: "furnace2" } })
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

	it.todo("CODE_REVIEW.md 2.6: doesn't turn off a furnace that's still smelting once its import slot empties");
});
