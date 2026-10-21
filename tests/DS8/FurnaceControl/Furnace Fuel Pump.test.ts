import { describe, expect, it } from "vitest";
import type { World } from "@tasermonkey/ic10-bench";
import { build, CELL, defines, rack, type RackSetup, setScratch, STATE } from "./rack.ts";
import { recipe } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Fuel Pump.ic10";
const { IGNITE_BELOW, COLD, GAS_R } = defines(SCRIPT);
const IRON = recipe("ItemIronIngot");
const INVAR = recipe("ItemInvarIngot"); // a pressure floor of 18000 kPa

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["fuel"] });

async function inBatch(world: World, number: number) {
	setScratch(world, CELL.state, STATE.active);
	setScratch(world, CELL.job, number);
	await world.runTicks(2);
}

/** Hash.ic10's fuel volume: V · min kPa · (max K / T) · 500 / (T_fuel · n_fuel · R). */
function expectedVolume(minKpa: number, maxK: number, furnaceK: number, line = { Volume: 100, Temperature: 300, TotalMoles: 100 }) {
	return (line.Volume * minKpa * (maxK / (furnaceK || COLD)) * 500) / (line.Temperature * line.TotalMoles * GAS_R);
}

describe("Furnace Fuel Pump (DS-8)", () => {
	it("keeps the pump off outside a batch", async () => {
		const world = await fit();
		for (const state of [STATE.idle, STATE.ready, STATE.unloading, STATE.emergency]) {
			setScratch(world, CELL.state, state);
			setScratch(world, CELL.job, IRON.number);
			await world.runTicks(2);
			expect(world.device("fuelPump")).toHaveProps({ On: 0, Setting: 0 });
			expect(rack(world).memory(CELL.fuelOn)).toBe(0);
		}
		expect(world.chip("fuel")).toHaveNoErrors();
	});

	it("runs while the furnace is under the recipe's min K, and stops at it", async () => {
		const world = await fit({ props: { furnace: { Temperature: IRON.recipe.minK - 1, Pressure: 5000 } } });
		await inBatch(world, IRON.number);
		expect(world.device("fuelPump")).toHaveProps({ On: 1 });
		expect(rack(world).memory(CELL.fuelOn)).toBe(1);

		world.device("furnace").set("Temperature", IRON.recipe.minK);
		await world.runTicks(2);
		expect(world.device("fuelPump")).toHaveProps({ On: 0 });
		expect(rack(world).memory(CELL.fuelOn)).toBe(0);
	});

	it("runs while the furnace is under the recipe's min kPa, even when hot enough", async () => {
		const world = await fit({ props: { furnace: { Temperature: 1300, Pressure: INVAR.recipe.minKpa - 1 } } });
		await inBatch(world, INVAR.number);
		expect(world.device("fuelPump")).toHaveProps({ On: 1 });

		world.device("furnace").set("Pressure", INVAR.recipe.minKpa);
		await world.runTicks(2);
		expect(world.device("fuelPump")).toHaveProps({ On: 0 });
	});

	it("sets the volume as Hash.ic10 did, more for a cold furnace", async () => {
		const world = await fit({ props: { furnace: { Temperature: 500 } } });
		await inBatch(world, IRON.number);
		const warm = world.device("fuelPump").get("Setting");
		expect(warm).toBeCloseTo(expectedVolume(IRON.recipe.minKpa, IRON.recipe.maxK, 500), 6);

		world.device("furnace").set("Temperature", 0); // counts as COLD
		await world.runTicks(2);
		const cold = world.device("fuelPump").get("Setting");
		expect(cold).toBeCloseTo(expectedVolume(IRON.recipe.minKpa, IRON.recipe.maxK, 0), 6);
		expect(cold).toBeGreaterThan(warm);
	});

	it("sets no volume while the fuel line is empty", async () => {
		const world = await fit({ props: { fuelPa: { TotalMoles: 0 } } });
		await inBatch(world, IRON.number);
		expect(world.device("fuelPump").get("Setting")).toBe(0);
		expect(world.chip("fuel")).toHaveNoErrors();
	});

	it(`lights the furnace at or below ${IGNITE_BELOW} K`, async () => {
		const world = await fit({ props: { furnace: { Temperature: IGNITE_BELOW } } });
		await inBatch(world, IRON.number);
		expect(world.device("furnace")).toHaveProps({ Activate: 1 });

		world.device("furnace").set("Temperature", IGNITE_BELOW + 1);
		await world.runTicks(2);
		expect(world.device("furnace")).toHaveProps({ Activate: 0 });
	});

	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["fuelPa"] });
		await world.runTicks(5);
		expect(world.chip("fuel")).toHaveNoErrors();
		expect(world.chip("fuel")).toNeverAutoYield();
	});
});
