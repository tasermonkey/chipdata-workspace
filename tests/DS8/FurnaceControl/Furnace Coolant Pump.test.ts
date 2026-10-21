import { describe, expect, it } from "vitest";
import type { World } from "@tasermonkey/ic10-bench";
import { build, CELL, defines, rack, type RackSetup, setScratch, STATE } from "./rack.ts";
import { recipe } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Coolant Pump.ic10";
const { MOVE, GAS_R } = defines(SCRIPT);
const SOLDER = recipe("ItemSolderIngot"); // max 550 K

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["coolant"] });

async function inBatch(world: World, number: number) {
	setScratch(world, CELL.state, STATE.active);
	setScratch(world, CELL.job, number);
	await world.runTicks(2);
}

/** Hash.ic10's coolant volume: V · max(1, T / max K) · 250000 / (n · R): about 30 moles a tick. */
function expectedVolume(furnaceK: number, maxK: number, line = { Volume: 100, TotalMoles: 100 }) {
	return (line.Volume * Math.max(1, furnaceK / maxK) * MOVE) / (line.TotalMoles * GAS_R);
}

describe("Furnace Coolant Pump (DS-8)", () => {
	it("keeps the pump off outside a batch", async () => {
		const world = await fit({ props: { furnace: { Temperature: 5000 } } });
		for (const state of [STATE.idle, STATE.ready, STATE.unloading, STATE.emergency]) {
			setScratch(world, CELL.state, state);
			setScratch(world, CELL.job, SOLDER.number);
			await world.runTicks(2);
			expect(world.device("coolantPump")).toHaveProps({ On: 0, Setting: 0 });
			expect(rack(world).memory(CELL.coolOn)).toBe(0);
		}
		expect(world.chip("coolant")).toHaveNoErrors();
	});

	it("runs only while the furnace is over the recipe's max K", async () => {
		const world = await fit({ props: { furnace: { Temperature: SOLDER.recipe.maxK } } });
		await inBatch(world, SOLDER.number);
		expect(world.device("coolantPump")).toHaveProps({ On: 0 });

		world.device("furnace").set("Temperature", SOLDER.recipe.maxK + 1);
		await world.runTicks(2);
		expect(world.device("coolantPump")).toHaveProps({ On: 1 });
		expect(rack(world).memory(CELL.coolOn)).toBe(1);
	});

	it("sets the volume as Hash.ic10 did, more the hotter it is", async () => {
		const world = await fit({ props: { furnace: { Temperature: 600 } } });
		await inBatch(world, SOLDER.number);
		const warm = world.device("coolantPump").get("Setting");
		expect(warm).toBeCloseTo(expectedVolume(600, SOLDER.recipe.maxK), 6);

		world.device("furnace").set("Temperature", 1100); // twice max K
		await world.runTicks(2);
		expect(world.device("coolantPump").get("Setting")).toBeCloseTo(2 * expectedVolume(SOLDER.recipe.maxK, SOLDER.recipe.maxK), 6);
	});

	it("sets no volume while the coolant line is empty", async () => {
		const world = await fit({ props: { furnace: { Temperature: 600 }, coolantPa: { TotalMoles: 0 } } });
		await inBatch(world, SOLDER.number);
		expect(world.device("coolantPump").get("Setting")).toBe(0);
		expect(world.chip("coolant")).toHaveNoErrors();
	});

	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["coolantPump"] });
		await world.runTicks(5);
		expect(world.chip("coolant")).toHaveNoErrors();
		expect(world.chip("coolant")).toNeverAutoYield();
	});
});
