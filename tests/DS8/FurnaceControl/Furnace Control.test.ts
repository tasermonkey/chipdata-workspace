import { describe, expect, it } from "vitest";
import { hash, type World } from "@tasermonkey/ic10-bench";
import { build, CELL, lever, rack, type RackSetup, setScratch, STATE } from "./rack.ts";
import { recipe, ROW } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Control.ic10";
const IRON = recipe("ItemIronIngot");

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["control"] });
const state = (world: World) => rack(world).memory(CELL.state);

/** As the Panel's Confirm does: the target, then the recipe. */
async function confirm(world: World, number = IRON.number, target = 100) {
	setScratch(world, CELL.target, target);
	setScratch(world, CELL.request, number);
	await world.runTicks(2);
}

describe("Furnace Control (DS-8)", () => {
	it(`runs ${SCRIPT.split("/").pop()} from socket 1`, async () => {
		const world = await fit();
		await world.runTicks(2);
		expect(world.chip("control").db.key).toBe("rack");
		expect(world.chip("control")).toHaveNoErrors();
	});

	describe("before a batch", () => {
		it("is Idle while the furnace is off, and Ready once it's on", async () => {
			const world = await fit({ props: { furnace: { On: 0 } } });
			await world.runTicks(2);
			expect(state(world)).toBe(STATE.idle);

			world.device("furnace").set("On", 1);
			await world.runTicks(2);
			expect(state(world)).toBe(STATE.ready);
			expect(world.device("furnace")).toHaveProps({ Open: 0, SettingInput: 0 });
		});

		it("is NoDisk with no recipes on the drive, or no drive", async () => {
			const empty = await fit({ recipes: false });
			await empty.runTicks(2);
			expect(state(empty)).toBe(STATE.noDisk);

			const noDrive = await fit({ recipes: false, rack: { drives: [] } });
			await noDrive.runTicks(2);
			expect(state(noDrive)).toBe(STATE.noDisk);
		});

		it("doesn't mind an ID in drive cell 0, as the rack's Network program stores on F1", async () => {
			const world = await fit({ rack: { memory: { 0: 6755 } } });
			await world.runTicks(2);
			expect(state(world)).toBe(STATE.ready);
		});

		it("is Held while the HOLD cell isn't 0, and won't start a batch", async () => {
			const world = await fit();
			setScratch(world, CELL.hold, -1);
			await confirm(world);
			expect(state(world)).toBe(STATE.held);
			expect(rack(world).memory(CELL.job)).toBe(0);
		});

		it("waits, without errors, until the furnace and the release lever are on their ports", async () => {
			const world = await fit({ without: ["releaseLever"] });
			await world.runTicks(5);
			expect(state(world)).toBe(STATE.idle); // as it starts
			expect(world.chip("control")).toHaveNoErrors();

			rack(world).port(8, "releaseLever");
			await world.runTicks(2);
			expect(state(world)).toBe(STATE.ready);
		});
	});

	describe("a batch", () => {
		it("starts on a request while Ready: JOB is the recipe, and the input opens", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world);
			expect(state(world)).toBe(STATE.active);
			expect(rack(world).memory(CELL.job)).toBe(IRON.number);
			expect(rack(world).memory(CELL.request)).toBe(0);
			expect(world.device("furnace")).toHaveProps({ SettingInput: 100, Open: 0 });
		});

		it("unloads once the ingot is forming and its Reagents are all in, then is Ready", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world, IRON.number, 100);

			world.device("furnace").set("RecipeHash", hash("ItemIronIngot")).set("Reagents", 99);
			await world.runTicks(2);
			expect(state(world)).toBe(STATE.active);

			world.device("furnace").set("Reagents", 100);
			await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.unloading, { maxTicks: 5 });
			await world.runTicks(1);
			expect(world.device("furnace")).toHaveProps({ Open: 1 });

			world.device("furnace").set("Reagents", 0);
			await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.ready, { maxTicks: 5 });
			expect(world.device("furnace")).toHaveProps({ Open: 0 });
			expect(rack(world).memory(CELL.job)).toBe(0);
			expect(world.chip("control")).toHaveNoErrors();
		});

		it("doesn't unload a different ingot", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world, IRON.number, 100);
			world.device("furnace").set("RecipeHash", hash("ItemSteelIngot")).set("Reagents", 100);
			await world.runTicks(3);
			expect(state(world)).toBe(STATE.active);
		});

		it("unloads when the furnace is opened by hand", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world);
			world.device("furnace").set("Open", 1).set("Reagents", 5);
			await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.unloading, { maxTicks: 5 });
		});

		it("drops the batch if the drive is pulled", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world);
			rack(world).removeDrive(1);
			await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.noDisk, { maxTicks: 5 });
			expect(rack(world).memory(CELL.job)).toBe(0);
		});

		it("reads the recipe from the drive row the request names", async () => {
			const world = await fit();
			await world.runTicks(2);
			await confirm(world, 10);
			// Solder's row: the ingot is checked against it
			expect(rack(world).memory(10 * ROW)).toBe(hash("ItemSolderIngot"));
			world.device("furnace").set("RecipeHash", hash("ItemSolderIngot")).set("Reagents", 100);
			await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.unloading, { maxTicks: 5 });
		});
	});

	describe("the emergency release lever", () => {
		for (const during of ["Ready", "a batch", "unloading"] as const) {
			it(`ends ${during}, shuts the input, and holds until it's back`, async () => {
				const world = await fit();
				await world.runTicks(2);
				if (during !== "Ready") await confirm(world);
				if (during === "unloading") {
					world.device("furnace").set("RecipeHash", hash("ItemIronIngot")).set("Reagents", 100);
					await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.unloading, { maxTicks: 5 });
				}

				lever(world, "releaseLever", true);
				await world.runTicks(2);
				expect(state(world)).toBe(STATE.emergency);
				expect(rack(world).memory(CELL.job)).toBe(0);
				expect(world.device("furnace")).toHaveProps({ SettingInput: 0 });

				await confirm(world); // ignored
				expect(state(world)).toBe(STATE.emergency);
				expect(rack(world).memory(CELL.request)).toBe(0);

				lever(world, "releaseLever", false);
				await world.runTicks(2);
				expect(state(world)).toBe(STATE.ready);
				expect(world.chip("control")).toHaveNoErrors();
			});
		}
	});
});
