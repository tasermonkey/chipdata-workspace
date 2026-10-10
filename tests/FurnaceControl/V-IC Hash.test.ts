import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

// From the Steam Workshop (AdvFurnaceControl/README.MD). The housings are compact IC housings, found by name.
const SCRIPT = "ic10/FurnaceControl/AdvFurnaceControl/V-IC Hash.ic10";

/** Recipe hashes and packed limits, as the script lists them, by ingot dial position. */
const IRON = { dial: 1, hash: -1301215609, limits: 0.0095010000001001 };
const STEEL = { dial: 8, hash: -654790771 };
const CONSTANTAN = { dial: 12, hash: 1058547521 };
const STELLITE = { dial: 17, hash: -1897868623 };

interface Setup {
	ingot?: number;
	amount?: number;
	ventLever?: number;
	temps?: { o2: number; h2: number };
}

function build({ ingot = 1, amount = 2, ventLever = 1, temps = { o2: 300, h2: 300 } }: Setup = {}) {
	return sim({ root: REPO_ROOT })
		.device("ingotDial", "StructureLogicDial", { Setting: ingot }, { name: "Ingot Dial" })
		.device("amountDial", "StructureLogicDial", { Setting: amount }, { name: "Amount Dial" })
		.device("confirm", "StructureLogicButton", {}, { name: "Confirm Button" })
		.device("override", "StructureLogicSwitch", {}, { name: "Override" })
		.device("ventLever", "StructureLogicSwitch", { Open: ventLever }, { name: "VentLever" })
		.device("vent1", "StructureActiveVent", {}, { name: "Vent 1" })
		.device("vent2", "StructureActiveVent", {}, { name: "Vent 2" })
		.device("o2", "StructurePipeAnalysizer", { Temperature: temps.o2 }, { name: "O2 Analyzer" })
		.device("h2", "StructurePipeAnalysizer", { Temperature: temps.h2 }, { name: "H2 Analyzer" })
		.device("mixer", "StructureGasMixer", {}, { name: "Fuel Mixer" })
		.device("amountLed", "StructureConsoleLED5", {}, { name: "Amount" })
		.housing("furnaceIc", { code: "yield\nj 0", prefab: "StructureCircuitHousingCompact", name: "Furnace IC" })
		.housing("hash", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", name: "Hash IC" })
		.build();
}

describe("V-IC Hash (Advanced Furnace Control)", () => {
	it("sets up the dials' ranges and turns the pipe analyzers on", async () => {
		const world = await build();
		await world.runTicks(1);
		expect(world.device("ingotDial")).toHaveProps({ Mode: 17 });
		expect(world.device("amountDial")).toHaveProps({ Mode: 30 });
		expect(world.device("o2")).toHaveProps({ On: 1 });
		expect(world.chip("hash")).toHaveNoErrors();
	});

	const recipes: [string, typeof IRON | typeof STEEL, number][] = [
		["iron (×50)", IRON, 50],
		["steel (×200)", STEEL, 200],
		["an alloy (×100)", CONSTANTAN, 100],
		["a super alloy (×50)", STELLITE, 50],
	];
	for (const [what, recipe, per] of recipes) {
		it(`shows the recipe for ${what} on its housing, and the amount in ore`, async () => {
			const world = await build({ ingot: recipe.dial, amount: 3 });
			await world.runTicks(3);
			expect(world.db("hash")).toHaveProps({ Setting: recipe.hash });
			expect(world.device("amountLed")).toHaveProps({ Setting: 3 * per });
		});
	}

	it("shows no recipe with the ingot dial at 0", async () => {
		const world = await build({ ingot: 0 });
		await world.runTicks(3);
		expect(world.db("hash")).toHaveProps({ Setting: 0 });
	});

	it("keeps the dials in range: ingot at most 17, amount at least 1", async () => {
		const world = await build({ ingot: 20, amount: 0 });
		await world.runTicks(3);
		expect(world.device("ingotDial")).toHaveProps({ Setting: 17 });
		expect(world.device("amountDial")).toHaveProps({ Setting: 1 });
	});

	it("hands the recipe's packed limits to the Furnace IC when Confirm is pressed", async () => {
		const world = await build({ ingot: IRON.dial });
		await world.runTicks(3);
		expect(world.db("furnaceIc")).toHaveProps({ Setting: 0 });

		world.device("confirm").set("Setting", 1);
		await world.runTicks(3);
		expect(world.db("furnaceIc")).toHaveProps({ Setting: IRON.limits });
		expect(world.chip("hash")).toHaveNoErrors();
	});

	it("runs the furnace room's vents while the vent lever is down, and stops them when it's up", async () => {
		const world = await build({ ventLever: 0 });
		await world.runTicks(2);
		expect(world.device("vent1")).toHaveProps({ On: 1, Mode: 0, PressureExternal: 101, PressureInternal: 0 });
		expect(world.device("vent2")).toHaveProps({ On: 1, Mode: 1, PressureExternal: 101, PressureInternal: 55000 });

		world.device("ventLever").set("Open", 1);
		await world.runTicks(2);
		expect(world.device("vent1")).toHaveProps({ PressureExternal: 0 });
		expect(world.device("vent2")).toHaveProps({ PressureExternal: 0 });
	});

	it("sets the fuel mixer for a 2:1 hydrogen-to-oxygen mix, corrected for temperature", async () => {
		const world = await build({ temps: { o2: 300, h2: 300 } });
		await world.runTicks(2);
		expect(world.device("mixer")).toHaveProps({ Setting: expect.closeTo(100 / 1.5, 5) });

		world.device("o2").set("Temperature", 600);
		await world.runTicks(2);
		expect(world.device("mixer")).toHaveProps({ Setting: expect.closeTo(50, 5) });
	});
});
