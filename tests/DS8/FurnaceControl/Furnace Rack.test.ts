/**
 * Every DS-8 furnace chip together, in one rack:
 * ic10/DS8/FurnaceControl/Furnace Control.ic10, Furnace Release.ic10, Furnace Fuel Pump.ic10,
 * Furnace Coolant Pump.ic10, Furnace Fuel Mixer.ic10, Furnace Panel.ic10, Furnace Status.ic10,
 * Furnace Box.ic10, Furnace Readouts.ic10 and Furnace Recipes Setup.ic10.
 */
import { describe, expect, it } from "vitest";
import { Color, hash, press, type World } from "@tasermonkey/ic10-bench";
import { build, CELL, type ChipName, CHIPS, defines, lever, PORTS, portAt, rack, STATE } from "./rack.ts";
import { COUNT, recipe } from "./recipes.ts";

const IRON = recipe("ItemIronIngot");
const state = (world: World) => rack(world).memory(CELL.state);

describe("the DS-8 furnace rack", () => {
	it("fits its chips in the rack's twelve sockets", () => {
		expect(Object.keys(CHIPS).length).toBeLessThanOrEqual(12);
	});

	it("has every chip agree on the rack's memory, states and shared ports", () => {
		const shared = ["COUNT", "ROW", "MIN_K", "MAX_K", "MIN_KPA", "MAX_KPA", "PER_STEP", "STATE", "REQUEST", "TARGET", "JOB", "HOLD", "FUEL_ON", "COOL_ON"];
		const states = ["IDLE", "READY", "HELD", "NODISK", "ACTIVE", "UNLOADING", "EMERGENCY"];
		const seen: Record<string, [ChipName, number][]> = {};
		for (const [chip, script] of Object.entries(CHIPS) as [ChipName, string][]) {
			for (const [name, value] of Object.entries(defines(script))) {
				if (shared.includes(name) || states.includes(name)) (seen[name] ??= []).push([chip, value]);
			}
		}
		for (const [name, uses] of Object.entries(seen)) {
			expect(new Set(uses.map(([, v]) => v)).size, `${name}: ${JSON.stringify(uses)}`).toBe(1);
		}
		// Ports more than one chip uses
		expect(portAt(defines(CHIPS.release).FURNACE_PORT)).toBe(PORTS.furnace);
		expect(portAt(defines(CHIPS.fuel).FURNACE_PORT)).toBe(PORTS.furnace);
		expect(portAt(defines(CHIPS.coolant).FURNACE_PORT)).toBe(PORTS.furnace);
		expect(portAt(defines(CHIPS.readouts).FURNACE_PORT)).toBe(PORTS.furnace);
		expect(portAt(defines(CHIPS.release).RELEASE_PORT)).toBe(PORTS.releaseLever);
		expect(portAt(defines(CHIPS.fuelMixer).FUEL_PA_PORT)).toBe(PORTS.fuelPa);
		// Each device on a port of its own
		expect(new Set(Object.values(PORTS)).size).toBe(Object.keys(PORTS).length);
	});

	it("runs a batch from a drive the setup chip wrote, with the setup chip taken out", async () => {
		// The setup chip, once, in a rack of its own
		const setup = await build({ chips: ["setup"], recipes: false });
		await setup.runUntil((w) => rack(w).memory(COUNT) > 0 && rack(w).memory(IRON.number * 8) !== 0, { maxTicks: 40 });
		await setup.runTicks(20);
		const cells = rack(setup).drive(1);
		expect(cells).toBeDefined();

		// The furnace's rack, with that drive
		const world = await build({ recipes: false, rack: { drives: [] } });
		rack(world).insertDrive(1, cells);
		await world.runTicks(3);
		expect(state(world)).toBe(STATE.ready);

		world.device("ingotDial").set("Setting", IRON.number);
		world.device("amountDial").set("Setting", 2);
		await world.runTicks(2);
		expect(world.device("amountLed").get("Setting")).toBe(2 * IRON.recipe.perStep);
		press(world, "confirm", "Setting");
		await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.active, { maxTicks: 5 });
		await world.runTicks(1);

		// Cold: fuel in, the furnace lit, the mixer off
		expect(world.device("furnace")).toHaveProps({ SettingInput: 100, Activate: 1 });
		expect(world.device("fuelPump")).toHaveProps({ On: 1 });
		expect(world.device("coolantPump")).toHaveProps({ On: 0 });
		expect(world.device("mixer")).toHaveProps({ On: 0 });
		expect(world.device("statusLight")).toHaveProps({ Color: Color.Green });
		expect(world.device("pumpsLed")).toHaveProps({ Color: Color.Orange });

		// Hot enough, at pressure: the fuel stops
		world.device("furnace").set("Temperature", 1000).set("Pressure", 5000);
		await world.runTicks(2);
		expect(world.device("fuelPump")).toHaveProps({ On: 0 });
		expect(world.device("pumpsLed")).toHaveProps({ Color: Color.Gray });

		// The ingot forms with every Reagent in: it unloads, then it's Ready again
		world.device("furnace").set("RecipeHash", hash("ItemIronIngot")).set("Reagents", 2 * IRON.recipe.perStep);
		await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.unloading, { maxTicks: 5 });
		await world.runTicks(1);
		expect(world.device("furnace")).toHaveProps({ Open: 1, SettingOutput: 0 });
		expect(world.device("statusLight")).toHaveProps({ Color: Color.Blue });

		world.device("furnace").set("Reagents", 0);
		await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.ready, { maxTicks: 5 });
		await world.runTicks(2);
		expect(world.device("furnace")).toHaveProps({ Open: 0 });
		expect(world.device("ingotDial")).toHaveProps({ Setting: 0 });
		expect(world.device("statusLight")).toHaveProps({ Color: Color.Yellow });

		for (const chip of Object.keys(CHIPS).filter((c) => c !== "setup")) expect(world.chip(chip), chip).toHaveNoErrors();
	});

	it("releases everything on the emergency lever, mid-batch", async () => {
		const world = await build();
		await world.runTicks(2);
		world.device("ingotDial").set("Setting", IRON.number);
		await world.runTicks(2);
		press(world, "confirm", "Setting");
		await world.runUntil((w) => rack(w).memory(CELL.state) === STATE.active, { maxTicks: 5 });

		lever(world, "releaseLever", true);
		await world.runTicks(2);
		expect(state(world)).toBe(STATE.emergency);
		expect(world.device("furnace")).toHaveProps({ SettingInput: 0, SettingOutput: 100 });
		expect(world.device("fuelPump")).toHaveProps({ On: 0 });
		expect(world.device("coolantPump")).toHaveProps({ On: 0 });
		expect(world.device("mixer")).toHaveProps({ On: 0 });
		expect(world.device("statusLight")).toHaveProps({ Color: Color.Red });

		lever(world, "releaseLever", false);
		await world.runTicks(2);
		expect(state(world)).toBe(STATE.ready);
		expect(world.device("furnace")).toHaveProps({ SettingOutput: 0 });
	});
});
