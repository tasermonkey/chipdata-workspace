import { describe, expect, it } from "vitest";
import { Color, LedMode } from "@tasermonkey/ic10-bench";
import { build, CELL, type Consoles, rack, type RackSetup, setScratch, STATE } from "./rack.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Status.ic10";

const fit = (setup: RackSetup = {}) => build({ ...setup, chips: ["status"] });

/** STR("…"): up to six ASCII characters, packed big-endian, as the game does. */
function str(text: string): number {
	return [...text].reduce((value, c) => value * 256 + c.charCodeAt(0), 0);
}

const STATES = [
	[STATE.idle, "Idle", Color.Gray],
	[STATE.ready, "Ready", Color.Yellow],
	[STATE.held, "Hold", Color.Orange],
	[STATE.noDisk, "NoDisk", Color.Purple],
	[STATE.active, "Active", Color.Green],
	[STATE.unloading, "Unload", Color.Blue],
	[STATE.emergency, "EMERG", Color.Red],
] as const;

const PUMPS = [
	[0, 0, "Off", Color.Gray],
	[1, 0, "Fuel", Color.Orange],
	[0, 1, "Cool", Color.Blue],
	[1, 1, "Both", Color.Purple],
] as const;

for (const consoles of ["vanilla", "modular"] as const satisfies readonly Consoles[]) {
	describe(`Furnace Status (DS-8), ${consoles} consoles`, () => {
		it("shows each state as text, and as a colour on the light", async () => {
			const world = await fit({ consoles });
			for (const [state, text, colour] of STATES) {
				setScratch(world, CELL.state, state);
				await world.runTicks(2);
				expect(world.device("statusLed"), text).toHaveProps({ On: 1, Mode: LedMode.String, Setting: str(text), Color: colour });
				expect(world.device("statusLight"), text).toHaveProps({ On: 1, Color: colour });
			}
			expect(world.chip("status")).toHaveNoErrors();
		});

		it("shows which pumps are feeding the furnace: neither, fuel, coolant, or both", async () => {
			const world = await fit({ consoles });
			for (const [fuel, cool, text, colour] of PUMPS) {
				setScratch(world, CELL.fuelOn, fuel);
				setScratch(world, CELL.coolOn, cool);
				await world.runTicks(2);
				expect(world.device("pumpsLed"), text).toHaveProps({ On: 1, Mode: LedMode.String, Setting: str(text), Color: colour });
			}
		});

		it("waits, without errors, until its devices are on their ports", async () => {
			const world = await fit({ consoles, without: ["pumpsLed"] });
			await world.runTicks(5);
			expect(world.chip("status")).toHaveNoErrors();
			expect(world.chip("status")).toNeverAutoYield();
		});
	});
}

describe(SCRIPT, () => {
	it("is only a display: it writes no scratch cell", async () => {
		const world = await fit();
		await world.runTicks(3);
		const scratch = Array.from({ length: 8 }, (_, i) => rack(world).memory(CELL.state + i));
		expect(scratch).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		expect(world.chip("status")).toHaveNoErrors();
	});
});
