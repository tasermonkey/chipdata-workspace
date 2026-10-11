import { describe, expect, it } from "vitest";
import { type LarreDockOptions, larreDock, sim, type World } from "../src/index.ts";

async function build(options: LarreDockOptions) {
	const world = await sim().device("larre", "StructureLarreDockHydroponics", { On: 1 }).build();
	const larre = larreDock(options);
	world.model("larre", larre.model);
	return { world, larre, dock: world.device("larre") };
}

/** Write Activate, as a chip would, and run until the arm is back up. */
async function activate(world: World) {
	world.device("larre").set("Activate", 1);
	await world.runTicks(1);
	await world.runUntil(() => world.device("larre").get("Idle") === 1, { maxTicks: 20 });
}

const READY = { mature: true, seeding: true, seeds: 1, harvest: 2 };

describe("larreDock", () => {
	it("moves a rail node a second, so stations further apart take longer", async () => {
		const { world, larre, dock } = await build({ stations: 4, nodes: { 3: 4 } });
		const idle = world.record("larre.Idle");
		const position = world.record("larre.PositionX");
		dock.set("Setting", 2);
		await world.runTicks(4);
		expect(idle.values.slice(1)).toEqual([0, 0, 0, 1]); // 2 nodes, 0.5 a tick
		expect(position.values.slice(1)).toEqual([-1, -1, -1, 2]);

		dock.set("Setting", 3);
		await world.runTicks(1);
		await world.runUntil(() => dock.get("Idle") === 1, { maxTicks: 20 });
		expect(world.tick - 4).toBe(8); // 4 nodes
		expect(larre.visited).toEqual([2, 3]);
	});

	it("clamps Setting to the rail, or wraps it on a loop and goes the shorter way", async () => {
		const line = await build({ stations: 5 });
		line.dock.set("Setting", 9);
		await line.world.runTicks(1);
		expect(line.dock.get("Setting")).toBe(4);

		const loop = await build({ stations: 5, looping: true });
		loop.dock.set("Setting", 9);
		await loop.world.runTicks(1);
		expect(loop.dock.get("Setting")).toBe(4);
		await loop.world.runUntil(() => loop.dock.get("Idle") === 1, { maxTicks: 20 });
		expect(loop.world.tick).toBe(2); // back one node past station 0, not four forward
	});

	it("runs an Activate cycle: down for 1 s, a 0.2 s pause, up for 1 s", async () => {
		const { world, dock } = await build({ stations: 2 });
		const record = (prop: string) => world.record(`larre.${prop}`);
		const [active, idle, extended] = [record("Activate"), record("Idle"), record("Extended")];
		await world.runTicks(1);
		dock.set("Activate", 1);
		await world.runTicks(6);
		expect(active.values.slice(2)).toEqual([1, 0, 1, 1, 0, 0]);
		expect(extended.values.slice(2)).toEqual([0, 1, 0, 0, 0, 0]);
		expect(idle.values.slice(2)).toEqual([0, 0, 0, 0, 1, 1]);
	});

	it("ignores Activate while moving, and an off dock reads idle wherever it is", async () => {
		const { world, dock } = await build({ stations: 4, nodes: 2, planters: { 3: READY } });
		dock.set("Setting", 3);
		await world.runTicks(1);
		dock.set("Activate", 1);
		await world.runTicks(1);
		expect(dock.get("Activate")).toBe(0);

		dock.set("On", 0);
		await world.runTicks(1);
		expect(dock.props("Idle", "PositionX")).toEqual({ Idle: 1, PositionX: -1 });
		dock.set("Activate", 1);
		await world.runTicks(3);
		expect(dock.get("Activate")).toBe(0);
	});

	it("takes one item per Activate, seeds first, swapping the hand into slot 1 for fruit", async () => {
		const { world, larre, dock } = await build({ stations: 2, planters: { 1: READY } });
		dock.set("Setting", 1);
		await world.runTicks(3);
		const target = dock.slot(255);
		expect([target.get("Class"), target.get("Mature"), target.get("Seeding")]).toEqual([11, 1, 1]);
		expect(dock.props("TargetSlotIndex")).toEqual({ TargetSlotIndex: 0 });

		await activate(world);
		expect(larre.hand).toEqual({ item: "SeedBag_Wheet", quantity: 1 });
		expect(target.get("Seeding")).toBe(0); // seeding, no seeds left

		await activate(world);
		expect([larre.hand, larre.extra]).toEqual([
			{ item: "ItemWheat", quantity: 1 },
			{ item: "SeedBag_Wheet", quantity: 1 },
		]);
		await activate(world);
		expect(larre.hand).toEqual({ item: "ItemWheat", quantity: 2 });
		expect(larre.planter(1)).toBeNull(); // all taken
		expect(target.occupied).toBe(false);
		expect(dock.slot(0).get("Quantity")).toBe(2);
	});

	it("does nothing when slot 1 is full and the hand holds something else", async () => {
		const { world, larre, dock } = await build({
			stations: 2,
			start: 1,
			planters: { 1: { mature: true, harvest: 3 } },
			hand: { item: "SeedBag_Wheet", quantity: 2 },
			extra: { item: "ItemFertilizer", quantity: 1 },
		});
		await activate(world);
		expect(larre.planter(1)).toMatchObject({ harvest: 3 });
		expect(larre.hand).toEqual({ item: "SeedBag_Wheet", quantity: 2 });
		expect(dock.get("Idle")).toBe(1);
	});

	it("plants a seed in an empty planter, and an empty hand destroys a plant with nothing to take", async () => {
		const { world, larre, dock } = await build({
			stations: 3,
			planters: { 1: null, 2: { harvest: 2 } },
			hand: { item: "SeedBag_Wheet", quantity: 2 },
		});
		dock.set("Setting", 1);
		await world.runTicks(3);
		await activate(world);
		expect(larre.planter(1)).toMatchObject({ mature: false, seeding: false });
		expect(dock.slot(255).get("Seeding")).toBe(-1);
		expect(larre.hand).toEqual({ item: "SeedBag_Wheet", quantity: 1 });

		const empty = await build({ stations: 3, start: 2, planters: { 2: { harvest: 2 } } });
		await activate(empty.world);
		expect(empty.larre.planter(2)).toBeNull(); // growing, not mature: cleared
	});

	it("drops the whole hand into a bin, then brings slot 1 to the hand; a jammed bin takes one drop", async () => {
		const options: LarreDockOptions = {
			stations: 2,
			start: 1,
			dropOff: 1,
			hand: { item: "ItemWheat", quantity: 4 },
			extra: { item: "SeedBag_Wheet", quantity: 1 },
		};
		const free = await build(options);
		await activate(free.world);
		expect(free.larre.delivered).toMatchObject([{ station: 1, item: "ItemWheat", quantity: 4 }]);
		expect([free.larre.hand, free.larre.extra]).toEqual([{ item: "SeedBag_Wheet", quantity: 1 }, undefined]);
		await activate(free.world);
		expect(free.larre.delivered).toHaveLength(2);

		const jammed = await build({ ...options, jammed: true });
		await activate(jammed.world);
		await activate(jammed.world);
		expect(jammed.larre.delivered).toHaveLength(1);
		expect(jammed.larre.hand).toEqual({ item: "SeedBag_Wheet", quantity: 1 });
		expect(jammed.dock.slot(255).get("Quantity")).toBe(4);
	});

	it("checks its stations", () => {
		expect(() => larreDock({ stations: 0 })).toThrow("larreDock: stations must be a whole number from 1, got 0");
		expect(() => larreDock({ stations: 3, dropOff: 3 })).toThrow("larreDock: a drop-off at station 3 is off the rail (stations 0 to 2)");
		expect(() => larreDock({ stations: 3, nodes: { 2: 0 } })).toThrow("larreDock: nodes to station 2 must be positive, got 0");
	});
});
