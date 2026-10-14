import { describe, expect, it } from "vitest";
import { activeVent, airConditioner, PIPE_VOLUME, sim, VentMode } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";
import { inRegister, stage } from "../support/stage.ts";

const SCRIPT = "ic10/ClimateControl/CoolCleanMarsAir [7335].ic10";

const SETPOINT = 290; // the AC's Setting, in kelvin

/** The chip sits in the AC unit itself; the waste side is warm enough and pressurised. */
function build(inputTemp: number) {
	return sim({ root: REPO_ROOT })
		.device("coolant", "StructureActiveVent", { PressureOutput: 1000, TemperatureOutput: 280 }, { name: "CoolantVent" })
		.housing("ac", {
			file: SCRIPT,
			prefab: "StructureAirConditioner",
			props: {
				Setting: SETPOINT,
				TemperatureInput: inputTemp,
				PressureOutput2: 1000,
				TemperatureOutput2: 285,
			},
		})
		.build();
}

describe("CoolCleanMarsAir", () => {
	it("cools while the input is above the setpoint", async () => {
		const world = await build(300);
		await world.runTicks(3);

		expect(world.db("ac")).toHaveProps({ Mode: 1 });
		expect(world.chip("ac")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 1.5: it cooled while the input was anything but exactly the setpoint.
	it("stops once the input is below the setpoint, and starts again when it warms", async () => {
		const world = await build(300);
		await world.runTicks(3);

		world.db("ac").set("TemperatureInput", 285);
		await world.runTicks(2);
		expect(world.db("ac")).toHaveProps({ Mode: 0 });
		expect(world.chip("ac")).toHaveRegister("GasCoolingStage", 0);

		world.db("ac").set("TemperatureInput", 295);
		await world.runTicks(2);
		expect(world.db("ac")).toHaveProps({ Mode: 1 });
		expect(world.chip("ac")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 2.2: draining waited for the coolant pipe to read exactly 0 kPa.
	it("cycles the coolant: fill to 2500 kPa, hold until 288 K, then drain until near-empty", async () => {
		const world = await build(285);
		const vent = world.device("coolant");
		const ac = inRegister("ac");
		await world.runTicks(2);
		expect(vent).toHaveProps({ Mode: VentMode.Inward, On: 1 }); // filling

		vent.set("PressureOutput", 2500);
		await world.runTicks(2);
		expect(stage(world, ac)).toBe(1);
		expect(vent).toHaveProps({ On: 0 }); // holding

		vent.set("TemperatureOutput", 290);
		await world.runTicks(2);
		expect(stage(world, ac)).toBe(2);
		expect(vent).toHaveProps({ Mode: VentMode.Outward, On: 1 }); // draining

		vent.set("PressureOutput", 1.5);
		await world.runTicks(4);
		expect(stage(world, ac)).toBe(2); // not empty yet
		vent.set("PressureOutput", 0.4);
		await world.runTicks(3);
		expect(stage(world, ac)).toBe(0);
		expect(vent).toHaveProps({ Mode: VentMode.Inward, On: 1 }); // filling again
		expect(world.chip("ac")).toHaveNoErrors();
	});
});

/**
 * The build with gas in it: the AC cools a loop of base air (its input and output on one pipe)
 * into its waste pipe, which is the coolant the vent fills from cold outside air and drains when
 * it's warm. Mars-like outside air; the numbers are illustrative, not from the save.
 */
async function buildWithGas() {
	const world = await sim({ root: REPO_ROOT })
		.room("outside", { temperature: 220, pressure: 9, ratios: { CarbonDioxide: 1 } })
		.pipe("base", { volume: 60_000, temperature: 320, pressure: 120, ratios: { Nitrogen: 0.8, Oxygen: 0.2 } })
		.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 220 })
		.device("vent", "StructureActiveVent", {}, { name: "CoolantVent", ports: { output: "coolant" }, room: "outside" })
		.housing("ac", {
			file: SCRIPT,
			prefab: "StructureAirConditioner",
			props: { On: 1, Setting: SETPOINT },
			ports: { input: "base", output: "base", output2: "coolant" },
		})
		.build();
	world.model("vent", activeVent());
	world.model("ac", airConditioner());
	return world;
}

describe("CoolCleanMarsAir, with gas", () => {
	it("cools the base air to the setpoint, draining and refilling the coolant as it warms", async () => {
		const world = await buildWithGas();
		const stages: number[] = [];
		world.every({ ticks: 1 }, (w) => stages.push(stage(w, inRegister("ac"))));

		// The AC stops within 1 K of its Setting.
		await world.runUntil((w) => w.pipe("base").temperature < SETPOINT + 1, { maxTicks: 400 });
		expect(world.pipe("base").temperature).toBeGreaterThan(SETPOINT - 0.5);
		const drains = stages.filter((s, i) => s === 2 && stages[i - 1] !== 2).length;
		expect(drains).toBeGreaterThanOrEqual(2);

		await world.runTicks(20);
		expect(world.pipe("base").temperature).toBeGreaterThan(SETPOINT - 0.5); // and stays there
		expect(world.chip("ac")).toHaveNoErrors();
	});

	it("keeps the AC off while the coolant is under 200 kPa or over 293 K", async () => {
		const world = await buildWithGas();
		const mode = world.record("ac.Mode");
		const pressure = world.record("coolant.Pressure");
		const temperature = world.record("coolant.Temperature");
		await world.runTicks(200);

		const offWhenItShouldBe = mode.values.every((m, i) => m === 0 || (pressure.values[i]! >= 200 && temperature.values[i]! <= 293));
		expect(offWhenItShouldBe).toBe(true);
		expect(Math.min(...pressure.values.slice(5))).toBeLessThan(200); // it did drain
		expect(world.chip("ac")).toHaveNoErrors();
	});
});
