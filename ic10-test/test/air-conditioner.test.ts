import { describe, expect, it } from "vitest";
import { airConditioner, IDEAL_GAS_CONSTANT, ONE_ATMOSPHERE, sim } from "../src/index.ts";

/** Nitrogen's specific heat in the game, J/(mol·K). */
const N2_HEAT = 20.6;

function acWorld(props: Record<string, number>, input: { temperature: number; pressure: number }, waste: { temperature: number; pressure: number }) {
	return sim()
		.pipe("in", { volume: 100, ...input, ratios: { Nitrogen: 1 } })
		.pipe("out", { volume: 100, temperature: 300 })
		.pipe("waste", { volume: 100, ...waste, ratios: { Nitrogen: 1 } })
		.device("ac", "StructureAirConditioner", props, { ports: { input: "in", output: "out", output2: "waste" } })
		.build();
}

/** Moles in `litres` at `kPa` and `kelvin`. */
const moles = (kPa: number, litres: number, kelvin: number) => (kPa * litres) / (IDEAL_GAS_CONSTANT * kelvin);

describe("airConditioner", () => {
	it("cools gas from input to output by 14 kJ a tick, warming the waste by the same", async () => {
		const world = await acWorld({ On: 1, Mode: 1, Setting: 290 }, { temperature: 320, pressure: 500 }, { temperature: 280, pressure: 500 });
		world.model("ac", airConditioner());
		await world.runTicks(1);
		const passed = moles(ONE_ATMOSPHERE, 100, 320);
		expect(world.pipe("out").totalMoles).toBeCloseTo(passed, 9);
		// No overshoot guard, as in the game's code: 4 mol takes all 14 kJ.
		expect(world.pipe("out").temperature).toBeCloseTo(320 - 14000 / (passed * N2_HEAT), 6);
		expect(world.pipe("waste").temperature).toBeCloseTo(280 + 14000 / (moles(500, 100, 280) * N2_HEAT), 6);
		expect(world.device("ac")).toHaveProps({
			TemperatureDifferentialEfficiency: 1,
			OperationalTemperatureEfficiency: 1,
			PressureEfficiency: 1,
		});
	});

	it("heats from the waste when Setting is above the input", async () => {
		const world = await acWorld({ On: 1, Mode: 1, Setting: 400 }, { temperature: 300, pressure: 500 }, { temperature: 350, pressure: 500 });
		world.model("ac", airConditioner());
		await world.runTicks(1);
		expect(world.pipe("out").temperature).toBeCloseTo(300 + 14000 / (moles(ONE_ATMOSPHERE, 100, 300) * N2_HEAT), 6);
		expect(world.pipe("waste").temperature).toBeCloseTo(350 - 14000 / (moles(500, 100, 350) * N2_HEAT), 6);
	});

	it("loses efficiency pumping heat uphill and with a thin waste pipe", async () => {
		const world = await acWorld({ On: 1, Mode: 1, Setting: 250 }, { temperature: 300, pressure: 500 }, { temperature: 400, pressure: 50 });
		world.model("ac", airConditioner());
		await world.runTicks(1);
		const pressureEfficiency = 50 / ONE_ATMOSPHERE - 0.1;
		expect(world.device("ac")).toHaveProps({
			TemperatureDifferentialEfficiency: expect.closeTo(0.5, 9), // 100 K uphill, by the default guess
			PressureEfficiency: expect.closeTo(pressureEfficiency, 9),
		});
		const energy = 14000 * 0.5 * pressureEfficiency;
		expect(world.pipe("out").temperature).toBeCloseTo(300 - energy / (moles(ONE_ATMOSPHERE, 100, 300) * N2_HEAT), 6);
	});

	it("takes tuned efficiency curves", async () => {
		const world = await acWorld({ On: 1, Mode: 1, Setting: 250 }, { temperature: 300, pressure: 500 }, { temperature: 300, pressure: 500 });
		world.model("ac", airConditioner({ temperatureDifferentialEfficiency: () => 0.5, operationalTemperatureEfficiency: (k) => (k > 299 ? 0.5 : 1) }));
		await world.runTicks(1);
		expect(world.pipe("out").temperature).toBeCloseTo(300 - 3500 / (moles(ONE_ATMOSPHERE, 100, 300) * N2_HEAT), 6);
	});

	it("passes no gas within 1 K of Setting, in Mode 0, or while off", async () => {
		for (const props of [
			{ On: 1, Mode: 1, Setting: 300.5 },
			{ On: 1, Mode: 0, Setting: 250 },
			{ On: 0, Mode: 1, Setting: 250 },
		]) {
			const world = await acWorld(props, { temperature: 300, pressure: 500 }, { temperature: 300, pressure: 500 });
			world.model("ac", airConditioner());
			await world.runTicks(2);
			expect(world.pipe("out").totalMoles).toBe(0);
		}
	});

	it("needs all three pipes", async () => {
		const world = await sim().device("ac", "StructureAirConditioner", { On: 1, Mode: 1 }).build();
		world.model("ac", airConditioner());
		await expect(world.runTicks(1)).rejects.toThrow(/air conditioner "ac" needs pipes on input, output, output2/);
	});
});
