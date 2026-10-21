import { describe, expect, it } from "vitest";
import type { World } from "@tasermonkey/ic10-bench";
import { build, CELL, defines, lever, type RackSetup, setScratch, STATE } from "./rack.ts";
import { recipe } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Release.ic10";
const { FULL, VENT_SPEED, FLUSH_ABOVE, PRESS_CAP } = defines(SCRIPT);
const INCONEL = recipe("ItemInconelIngot"); // the narrowest band: 23500-23800 kPa

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["release"] });
const output = (world: World) => world.device("furnace").get("SettingOutput");

/** Furnace Control's state, as this chip reads it. */
async function inState(world: World, state: number, job = 0) {
	setScratch(world, CELL.state, state);
	setScratch(world, CELL.job, job);
	await world.runTicks(2);
}

describe("Furnace Release (DS-8)", () => {
	describe("not in a batch", () => {
		it("keeps the output shut", async () => {
			const world = await fit();
			await inState(world, STATE.ready);
			expect(output(world)).toBe(0);
			expect(world.chip("release")).toHaveNoErrors();
		});

		it("opens it wide on the Flush lever", async () => {
			const world = await fit();
			lever(world, "flushLever", true);
			await inState(world, STATE.idle);
			expect(output(world)).toBe(FULL);
		});

		it(`opens it wide above ${FLUSH_ABOVE} kPa`, async () => {
			const world = await fit({ props: { furnace: { Pressure: FLUSH_ABOVE } } });
			await inState(world, STATE.ready);
			expect(output(world)).toBe(0);
			world.device("furnace").set("Pressure", FLUSH_ABOVE + 1);
			await world.runTicks(2);
			expect(output(world)).toBe(FULL);
		});

		it("keeps it shut while unloading, Flush or not", async () => {
			const world = await fit({ props: { furnace: { Pressure: FLUSH_ABOVE + 1 } } });
			lever(world, "flushLever", true);
			await inState(world, STATE.unloading);
			expect(output(world)).toBe(0);
		});
	});

	describe("in a batch", () => {
		it("vents only while over the recipe's max kPa, read exactly from the drive", async () => {
			const world = await fit({ props: { furnace: { Pressure: INCONEL.recipe.maxKpa } } });
			await inState(world, STATE.active, INCONEL.number);
			expect(output(world)).toBe(0);

			world.device("furnace").set("Pressure", INCONEL.recipe.maxKpa + 1);
			await world.runTicks(2);
			expect(output(world)).toBe(VENT_SPEED);
		});

		it(`counts pressure above ${PRESS_CAP} kPa as ${PRESS_CAP}`, async () => {
			const top = recipe("ItemConstantanIngot"); // max kPa is the cap
			const world = await fit({ props: { furnace: { Pressure: PRESS_CAP + 5000 } } });
			await inState(world, STATE.active, top.number);
			expect(output(world)).toBe(0);
		});

		it("ignores the Flush lever", async () => {
			const world = await fit();
			lever(world, "flushLever", true);
			await inState(world, STATE.active, INCONEL.number);
			expect(output(world)).toBe(0);
		});
	});

	describe("the emergency release lever", () => {
		for (const state of [STATE.ready, STATE.active, STATE.unloading]) {
			it(`opens the output wide (state ${state})`, async () => {
				const world = await fit();
				lever(world, "releaseLever", true);
				await inState(world, state, INCONEL.number);
				expect(output(world)).toBe(FULL);
			});
		}

		it("opens it even with Furnace Control not running", async () => {
			const world = await fit(); // only this chip; STATE stays 0
			await world.runTicks(2);
			lever(world, "releaseLever", true);
			await world.runTicks(2);
			expect(output(world)).toBe(FULL);
		});
	});

	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["flushLever"] });
		await world.runTicks(5);
		expect(world.chip("release")).toHaveNoErrors();
		expect(world.chip("release")).toNeverAutoYield();
	});
});
