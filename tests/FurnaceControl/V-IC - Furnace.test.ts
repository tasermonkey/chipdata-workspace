import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

// From the Steam Workshop (AdvFurnaceControl/README.MD). The housings are compact IC housings, found by name.
const SCRIPT = "ic10/FurnaceControl/AdvFurnaceControl/V-IC - Furnace.ic10";

const RED = 4;
const GREEN = 2;
const TEXT = 10; // LED Mode
/** Iron, as V-IC Hash hands it over: the recipe hash, and min/max temperature and pressure packed in one number. */
const IRON = { hash: -1301215609, limits: 0.0095010000001001 };

interface Setup {
	furnace?: { Temperature?: number; Pressure?: number; On?: number };
	fuelPressure?: number;
	flush?: number;
}

/** The advanced furnace and everything around it; "Hash IC" is a stand-in housing holding the requested recipe. */
function build({ furnace = {}, fuelPressure = 1000, flush = 0 }: Setup = {}) {
	const gas = { Temperature: 300, TotalMoles: 100, Volume: 100 };
	return sim({ root: REPO_ROOT })
		.device("furnace", "StructureAdvancedFurnace", { Temperature: 300, Pressure: 1000, On: 1, ...furnace }, { name: "A Furnace" })
		.device("fuelPa", "StructurePipeAnalysizer", { ...gas, Pressure: fuelPressure }, { name: "Fuel PA" })
		.device("coolantPa", "StructurePipeAnalysizer", gas, { name: "Coolant PA" })
		.device("mixer", "StructureGasMixer", {}, { name: "Fuel Mixer" })
		.device("light", "StructureDiode", {}, { name: "SLight" })
		.device("led", "StructureConsoleLED5", {}, { name: "SLed" })
		.device("amountLed", "StructureConsoleLED5", {}, { name: "Amount" })
		.device("flush", "StructureLogicSwitch", { Open: flush }, { name: "Flush" })
		.device("fuelPump", "StructureVolumePump", {}, { name: "FuelPump" })
		.device("coolantPump", "StructureVolumePump", {}, { name: "CoolantPump" })
		.device("ingotDial", "StructureLogicDial", { Setting: 1 }, { name: "Ingot Dial" })
		.housing("hashIc", { code: "yield\nj 0", prefab: "StructureCircuitHousingCompact", name: "Hash IC", props: { Setting: IRON.hash } })
		.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", name: "Furnace IC" })
		.build();
}

/** Hand the chip a recipe, as V-IC Hash's Confirm does. */
async function start(world: World) {
	await world.runTicks(2);
	world.db("ic").set("Setting", IRON.limits);
	await world.runTicks(2);
}

describe("V-IC - Furnace (Advanced Furnace Control)", () => {
	describe("waiting for a recipe", () => {
		it("shows Ready! in red, and keeps the furnace closed with the pumps off", async () => {
			const world = await build();
			await world.runTicks(2);

			expect(world.db("ic")).toHaveProps({ Setting: -1 });
			expect(world.device("light")).toHaveProps({ Color: RED, On: 1 });
			expect(world.device("led")).toHaveProps({ Mode: TEXT, On: 1 });
			expect(world.device("furnace")).toHaveProps({ Open: 0, SettingInput: 0, SettingOutput: 0 });
			expect(world.device("fuelPump")).toHaveProps({ On: 0 });
			expect(world.device("coolantPump")).toHaveProps({ On: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("mixes fuel while the fuel pipe is below 5,000 kPa", async () => {
			const low = await build({ fuelPressure: 4000 });
			await low.runTicks(2);
			expect(low.device("mixer")).toHaveProps({ On: 1 });

			const full = await build({ fuelPressure: 6000 });
			await full.runTicks(2);
			expect(full.device("mixer")).toHaveProps({ On: 0 });
		});

		it("vents the furnace with the Flush lever, or when it's over 40,000 kPa", async () => {
			const flushed = await build({ flush: 1 });
			await flushed.runTicks(2);
			expect(flushed.device("furnace")).toHaveProps({ SettingOutput: 100 });

			const high = await build({ furnace: { Pressure: 41000 } });
			await high.runTicks(2);
			expect(high.device("furnace")).toHaveProps({ SettingOutput: 100 });
		});
	});

	describe("smelting", () => {
		it("unpacks the recipe's limits and starts the furnace, in green", async () => {
			const world = await build();
			await start(world);

			const ic = world.chip("ic");
			expect(ic).toHaveRegister("mintemp", 950);
			expect(ic).toHaveRegister("maxtemp", 10000);
			expect(ic).toHaveRegister("minpress", 100);
			// 10000 packed, but the fourth ×100,000 magnifies the double's rounding: the game gets the same.
			expect(ic.reg("maxpress")).toBe(9921);
			expect(world.device("light")).toHaveProps({ Color: GREEN });
			expect(world.device("furnace")).toHaveProps({ Activate: 1, SettingInput: 100 });
			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(ic).toHaveNoErrors();
		});

		it("adds fuel while it's too cold and coolant while it's too hot", async () => {
			const world = await build();
			await start(world);
			expect(world.device("fuelPump")).toHaveProps({ On: 1 }); // 300 K < 950 K
			expect(world.device("coolantPump")).toHaveProps({ On: 0 });

			world.device("furnace").set("Temperature", 10500).set("Pressure", 5000);
			await world.runTicks(2);
			expect(world.device("fuelPump")).toHaveProps({ On: 0 });
			expect(world.device("coolantPump")).toHaveProps({ On: 1 });
		});

		it("opens the furnace once it has made the requested ingot, then waits for the next recipe", async () => {
			const world = await build();
			world.device("amountLed").set("Setting", 100);
			await start(world);
			expect(world.device("furnace")).toHaveProps({ Open: 0 });

			world.device("furnace").set("RecipeHash", IRON.hash).set("Reagents", 100);
			await world.runTicks(2);
			expect(world.device("furnace")).toHaveProps({ Open: 1 });

			world.device("furnace").set("Reagents", 0); // emptied
			await world.runTicks(4);
			expect(world.device("ingotDial")).toHaveProps({ Setting: 0 });
			expect(world.db("ic")).toHaveProps({ Setting: -1 });
			expect(world.device("furnace")).toHaveProps({ Open: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		});
	});
});
