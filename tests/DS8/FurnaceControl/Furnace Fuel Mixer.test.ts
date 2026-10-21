import { describe, expect, it } from "vitest";
import { build, CELL, defines, type RackSetup, setScratch, STATE } from "./rack.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Fuel Mixer.ic10";
const { TOP_UP } = defines(SCRIPT);

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["fuelMixer"] });

describe("Furnace Fuel Mixer (DS-8)", () => {
	it("mixes two H2 to one O2: at equal temperatures, two thirds from input 1", async () => {
		const world = await fit();
		await world.runTicks(2);
		expect(world.device("mixer").get("Setting")).toBeCloseTo(100 / 1.5, 6);
		expect(world.chip("fuelMixer")).toHaveNoErrors();
	});

	it("takes more of the hotter gas, as moles go with 1/T", async () => {
		const world = await fit({ props: { o2Pa: { Temperature: 600 }, h2Pa: { Temperature: 300 } } });
		await world.runTicks(2);
		expect(world.device("mixer").get("Setting")).toBeCloseTo(50, 6); // 100 / (1 + 600 / 600)
	});

	it(`tops the fuel line up to ${TOP_UP} kPa while no batch runs`, async () => {
		const world = await fit({ props: { fuelPa: { Pressure: TOP_UP - 1 } } });
		for (const state of [STATE.idle, STATE.ready, STATE.held, STATE.noDisk]) {
			setScratch(world, CELL.state, state);
			await world.runTicks(2);
			expect(world.device("mixer")).toHaveProps({ On: 1 });
		}
		world.device("fuelPa").set("Pressure", TOP_UP);
		await world.runTicks(2);
		expect(world.device("mixer")).toHaveProps({ On: 0 });
	});

	it("stays off in a batch, unloading, or an emergency", async () => {
		const world = await fit({ props: { fuelPa: { Pressure: 0 } } });
		for (const state of [STATE.active, STATE.unloading, STATE.emergency]) {
			setScratch(world, CELL.state, state);
			await world.runTicks(2);
			expect(world.device("mixer")).toHaveProps({ On: 0 });
		}
	});

	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["h2Pa"] });
		await world.runTicks(5);
		expect(world.chip("fuelMixer")).toHaveNoErrors();
		expect(world.chip("fuelMixer")).toNeverAutoYield();
	});
});
