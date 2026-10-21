import { describe, expect, it } from "vitest";
import { LedMode, press, type World } from "@tasermonkey/ic10-bench";
import { build, CELL, type Consoles, defines, rack, type RackSetup, setScratch, STATE } from "./rack.ts";
import { RECIPES, recipe } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Panel.ic10";
const { MAX_AMOUNT } = defines(SCRIPT);
const STEEL = recipe("ItemSteelIngot");

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["panel"] });

/** The furnace is Ready, as Furnace Control says, and the dials are set. */
async function ready(world: World, ingot: number, amount: number) {
	setScratch(world, CELL.state, STATE.ready);
	world.device("ingotDial").set("Setting", ingot);
	world.device("amountDial").set("Setting", amount);
	await world.runTicks(2);
}

for (const consoles of ["vanilla", "modular"] as const satisfies readonly Consoles[]) {
	describe(`Furnace Panel (DS-8), ${consoles} consoles`, () => {
		it("sets the dials' ranges: one step a recipe on the drive, and the amounts", async () => {
			const world = await fit({ consoles });
			await world.runTicks(2);
			expect(world.device("ingotDial")).toHaveProps({ Mode: RECIPES.length });
			expect(world.device("amountDial")).toHaveProps({ Mode: MAX_AMOUNT });
			expect(world.chip("panel")).toHaveNoErrors();
		});

		it("shows the Reagents the batch will use: Amount × the recipe's per step", async () => {
			const world = await fit({ consoles });
			await ready(world, STEEL.number, 3);
			expect(world.device("amountLed")).toHaveProps({ On: 1, Mode: LedMode.Default, Setting: 3 * STEEL.recipe.perStep });
		});

		it("keeps Amount at 1 or more, and the ingot within the recipes", async () => {
			const world = await fit({ consoles });
			await ready(world, RECIPES.length + 5, 0);
			expect(world.device("ingotDial")).toHaveProps({ Setting: RECIPES.length });
			expect(world.device("amountDial")).toHaveProps({ Setting: 1 });
		});

		it("Confirm, while Ready, asks for the recipe with its target", async () => {
			const world = await fit({ consoles });
			await ready(world, STEEL.number, 2);
			press(world, "confirm", "Setting");
			await world.runTicks(1);
			expect(rack(world).memory(CELL.request)).toBe(STEEL.number);
			expect(rack(world).memory(CELL.target)).toBe(2 * STEEL.recipe.perStep);
		});

		it("Confirm does nothing with no recipe picked, or the furnace not Ready", async () => {
			const none = await fit({ consoles });
			await ready(none, 0, 2);
			expect(none.device("amountLed")).toHaveProps({ Setting: 0 });
			press(none, "confirm", "Setting");
			await none.runTicks(2);
			expect(rack(none).memory(CELL.request)).toBe(0);

			for (const state of [STATE.idle, STATE.held, STATE.noDisk, STATE.active, STATE.unloading, STATE.emergency]) {
				const world = await fit({ consoles });
				await ready(world, STEEL.number, 2);
				setScratch(world, CELL.state, state);
				press(world, "confirm", "Setting");
				await world.runTicks(2);
				expect(rack(world).memory(CELL.request), `state ${state}`).toBe(0);
			}
		});

		it("turns the ingot dial back to none once a batch is out", async () => {
			const world = await fit({ consoles });
			await ready(world, STEEL.number, 2);
			setScratch(world, CELL.state, STATE.active);
			await world.runTicks(2);
			expect(world.device("ingotDial")).toHaveProps({ Setting: STEEL.number }); // kept through the batch
			setScratch(world, CELL.state, STATE.unloading);
			await world.runTicks(2);
			setScratch(world, CELL.state, STATE.ready);
			await world.runTicks(2);
			expect(world.device("ingotDial")).toHaveProps({ Setting: 0 });
		});

		it("waits, without errors, until its devices are on their ports", async () => {
			const world = await fit({ consoles, without: ["amountLed"] });
			await world.runTicks(5);
			expect(world.chip("panel")).toHaveNoErrors();
			expect(world.chip("panel")).toNeverAutoYield();
		});
	});
}
