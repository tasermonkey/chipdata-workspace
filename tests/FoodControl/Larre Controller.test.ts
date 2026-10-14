import { describe, expect, it } from "vitest";
import { type LarreDockOptions, type LarrePlant, larreDock, sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const DROP_OFF = 15; // the script's drop-off station (the import chute)
const STATIONS = 17; // the starting dock (0), planters 1 to 14 and 16, and the drop-off

/** Planters at every station but the dock and the drop-off, empty unless given a plant. */
async function build(plants: Record<number, LarrePlant>, options: Partial<LarreDockOptions> = {}) {
	const planters: Record<number, LarrePlant | null> = {};
	for (let station = 1; station < STATIONS; station++) {
		if (station !== DROP_OFF) planters[station] = plants[station] ?? null;
	}
	const world = await sim({ root: REPO_ROOT })
		.device("larre", "StructureLarreDockHydroponics", { On: 1 })
		.housing("ic", { file: "ic10/FoodControl/Larre Controller.ic10", pins: { d0: "larre" } })
		.build();
	const larre = larreDock({ stations: STATIONS, planters, dropOff: DROP_OFF, ...options });
	world.model("larre", larre.model);
	return { world, larre };
}

/** Ready to harvest: a seed to take, then two wheat. */
const READY: LarrePlant = { mature: true, seeding: true, seeds: 1, harvest: 2 };
const GROWING: LarrePlant = { harvest: 2 };

describe("Larre Controller", () => {
	it("visits every station in turn, skipping the drop-off, and starts again at the end of the track", async () => {
		const { world, larre } = await build({});
		await world.runUntil(() => larre.visited.filter((s) => s === 1).length >= 2, { maxTicks: 1000 });

		const lap = larre.visited.slice(0, larre.visited.lastIndexOf(1));
		expect(lap).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]); // then back to 1
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("harvests a ready plant, takes the harvest to the drop-off, and replants the seed", async () => {
		const { world, larre } = await build({ 3: READY });
		await world.runUntil(() => larre.planter(3)?.mature === false, { maxTicks: 1000 });

		expect(larre.delivered).toMatchObject([{ station: DROP_OFF, item: "ItemWheat", quantity: 2 }]);
		expect(larre.visited.slice(0, 5)).toEqual([1, 2, 3, DROP_OFF, 3]);
		expect(larre.planter(3)).toMatchObject({ seeding: false, seeds: 0, harvest: 0 });
		expect(larre.hand).toBeUndefined(); // the seed went into the planter
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("leaves a plant that isn't ready yet", async () => {
		const { world, larre } = await build({ 3: GROWING });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 1000 });

		expect(larre.delivered).toEqual([]);
		expect(larre.planter(3)).toMatchObject({ mature: false, harvest: 2 });
		expect(larre.visited).not.toContain(DROP_OFF);
	});

	it("first empties a full arm at the drop-off", async () => {
		const { world, larre } = await build({}, { hand: { item: "ItemWheat", quantity: 4 } });
		await world.runUntil(() => larre.delivered.length === 1, { maxTicks: 200 });
		expect(larre.visited[0]).toBe(DROP_OFF);
		expect(larre.delivered[0]).toMatchObject({ item: "ItemWheat", quantity: 4 });
	});

	// Mature was once read and overwritten, so only Seeding gated the harvest.
	it("leaves a seeding plant that isn't mature yet", async () => {
		const unripe: LarrePlant = { seeding: true, seeds: 1, harvest: 2 };
		const { world, larre } = await build({ 3: unripe });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 1000 });

		expect(larre.delivered).toEqual([]);
		expect(larre.planter(3)).toMatchObject(unripe);
		expect(larre.visited).not.toContain(DROP_OFF);
	});

	// The harvest loop once retried forever if Activate did nothing. In game that
	// happens when the arm holds one thing and its other slot another: there's nowhere to put fruit.
	it("gives up after five tries, empties the arm, and goes back for the rest", async () => {
		const stuck: LarrePlant = { mature: true, seeding: true, seeds: 1, harvest: 3 };
		const { world, larre } = await build({ 3: stuck, 5: READY }, { extra: { item: "ItemFertilizer", quantity: 1 } });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 1500 });

		// Station 3: a seed, then four Activates that do nothing. The seed goes to the drop-off and
		// the fertiliser comes to the hand, which leaves room for the fruit on the next try.
		expect(larre.visited.slice(0, 12)).toEqual([1, 2, 3, DROP_OFF, 3, DROP_OFF, 3, DROP_OFF, 4, 5, DROP_OFF, 5]);
		expect(larre.delivered.map((d) => [d.item, d.quantity])).toEqual([
			["SeedBag_Wheet", 1],
			["ItemWheat", 3],
			["ItemFertilizer", 1],
			["ItemWheat", 2],
		]);
		expect(larre.planter(3)).toBeNull(); // its seed went to the chute while the arm was stuck
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// The arm takes one item per Activate, so HARVEST_TRIES caps a visit at 5
	// items. With more, the script dropped the seeds at the chute and couldn't replant.
	it("goes back for the rest of a plant with more than five items, and replants it", async () => {
		const big: LarrePlant = { mature: true, seeding: true, seeds: 2, harvest: 5 };
		const { world, larre } = await build({ 3: big });
		await world.runUntil(() => larre.planter(3)?.mature === false, { maxTicks: 1500 });

		expect(larre.visited.slice(0, 7)).toEqual([1, 2, 3, DROP_OFF, 3, DROP_OFF, 3]);
		expect(larre.delivered.map((d) => [d.item, d.quantity])).toEqual([
			["ItemWheat", 3],
			["ItemWheat", 2],
		]);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
