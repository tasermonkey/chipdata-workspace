import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const DROP_OFF = 15; // the script's drop-off station (the import chute)
const LAST_STATION = 16;
const PLANT_CLASS = 11;
const ARM = 0;
const HOPPER = 1;
const TARGET = 255; // the plant at the arm

interface Plant {
	/** -1 while not yet seeded, as the script reads it. */
	seeding: number;
	mature: number;
	/** Activate does nothing here (say, the harvest won't fit). */
	stuck?: boolean;
}

/**
 * A small model of a hydroponics Larre, from how the script uses it (Phase 6 will have a proper one):
 * - Writing Setting sends it to that station, clamped to the track; Idle is 0 while it moves.
 * - Activate at a ready plant picks it (harvest in the arm, seed in the hopper); at an empty planter
 *   it plants the seed; at the drop-off it empties the arm into the chute.
 * - Slot 255 shows the plant at the current station.
 */
class LarreModel {
	position = 0;
	readonly plants = new Map<number, Plant>();
	readonly visited: number[] = [];
	delivered = 0;
	private arm = false;
	private seed = false;
	private readonly world: World;

	constructor(world: World, plants: Record<number, Plant>, { armFull = false } = {}) {
		this.world = world;
		for (const [station, plant] of Object.entries(plants)) this.plants.set(Number(station), plant);
		this.arm = armFull;
		world.every({ ticks: 1 }, () => this.tick());
		this.show();
	}

	private get larre() {
		return this.world.device("larre");
	}

	private tick() {
		const larre = this.larre;
		const wanted = Math.min(Math.max(larre.get("Setting"), 0), LAST_STATION);
		larre.set("Setting", wanted);
		if (wanted !== this.position) {
			this.position = wanted;
			this.visited.push(wanted);
			larre.set("Idle", 0);
		} else if (larre.get("Activate") === 1) {
			larre.set("Activate", 0);
			this.activate();
			larre.set("Idle", 0);
		} else {
			larre.set("Idle", 1);
		}
		this.show();
	}

	private activate() {
		const plant = this.plants.get(this.position);
		if (this.position === DROP_OFF) {
			if (this.arm) this.delivered++;
			this.arm = false;
		} else if (plant && plant.seeding !== -1 && !plant.stuck && !this.arm) {
			this.plants.delete(this.position);
			this.arm = true;
			this.seed = true;
		} else if (!plant && this.seed) {
			this.plants.set(this.position, { seeding: -1, mature: 0 });
			this.seed = false;
		}
	}

	private show() {
		const larre = this.larre;
		this.arm ? larre.slot(ARM).put("ItemWheat", { Quantity: 4 }) : larre.slot(ARM).clear();
		this.seed ? larre.slot(HOPPER).put("SeedBag_Wheet") : larre.slot(HOPPER).clear();
		const plant = this.plants.get(this.position);
		if (plant) {
			larre.slot(TARGET).put("ItemWheat", { Class: PLANT_CLASS, Seeding: plant.seeding, Mature: plant.mature });
		} else {
			larre.slot(TARGET).clear();
		}
	}
}

async function build(plants: Record<number, Plant>, options?: { armFull?: boolean }) {
	const world = await sim({ root: REPO_ROOT })
		.device("larre", "StructureLarreDockHydroponics", { Idle: 1 })
		.housing("ic", { file: "ic10/FoodControl/Larre Controller.ic10", pins: { d0: "larre" } })
		.build();
	return { world, larre: new LarreModel(world, plants, options) };
}

const READY: Plant = { seeding: 1, mature: 1 };
const GROWING: Plant = { seeding: -1, mature: 0 };

describe("Larre Controller", () => {
	it("visits every station in turn, skipping the drop-off, and starts again at the end of the track", async () => {
		const { world, larre } = await build({});
		await world.runUntil(() => larre.visited.filter((s) => s === 1).length >= 2, { maxTicks: 400 });

		const lap = larre.visited.slice(0, larre.visited.lastIndexOf(1));
		expect(lap).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]); // then back to 1
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("harvests a ready plant, takes the harvest to the drop-off, and replants the seed", async () => {
		const { world, larre } = await build({ 3: READY });
		await world.runUntil(() => larre.plants.get(3)?.seeding === -1, { maxTicks: 200 });

		expect(larre.delivered).toBe(1);
		expect(larre.visited.slice(0, 5)).toEqual([1, 2, 3, DROP_OFF, 3]);
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("leaves a plant that isn't ready yet", async () => {
		const { world, larre } = await build({ 3: GROWING });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 200 });

		expect(larre.delivered).toBe(0);
		expect(larre.plants.get(3)).toEqual(GROWING);
		expect(larre.visited).not.toContain(DROP_OFF);
	});

	it("first empties a full arm at the drop-off", async () => {
		const { world, larre } = await build({}, { armFull: true });
		await world.runUntil(() => larre.delivered === 1, { maxTicks: 50 });
		expect(larre.visited[0]).toBe(DROP_OFF);
	});

	// CODE_REVIEW.md 2.7: Mature was read and overwritten, so only Seeding gated the harvest.
	it("leaves a seeding plant that isn't mature yet", async () => {
		const unripe: Plant = { seeding: 1, mature: 0 };
		const { world, larre } = await build({ 3: unripe });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 200 });

		expect(larre.delivered).toBe(0);
		expect(larre.plants.get(3)).toEqual(unripe);
		expect(larre.visited).not.toContain(DROP_OFF);
	});

	// CODE_REVIEW.md 2.7: the harvest loop retried forever if Activate did nothing.
	it("gives up on a harvest that doesn't happen, and carries on round the track", async () => {
		const { world, larre } = await build({ 3: { ...READY, stuck: true }, 5: READY });
		await world.runUntil(() => larre.visited.includes(16), { maxTicks: 400 });

		expect(larre.visited.slice(0, 7)).toEqual([1, 2, 3, DROP_OFF, 3, 4, 5]);
		expect(larre.plants.get(3)).toMatchObject({ seeding: 1 }); // still there
		expect(larre.delivered).toBe(1); // station 5's
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
