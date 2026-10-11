import { describe, expect, it } from "vitest";
import { GASES, gasInfo, IDEAL_GAS_CONSTANT, PIPE_VOLUME } from "../src/atmos/gases.ts";
import { exchangeHeat, Mixture, Reservoir } from "../src/atmos/mixture.ts";
import { loadCatalog } from "../src/catalog/catalog.ts";

describe("gases", () => {
	it("has the game's specific heats", () => {
		expect(gasInfo("Nitrogen").specificHeat).toBe(20.6);
		expect(gasInfo("CarbonDioxide").specificHeat).toBe(28.2);
		expect(gasInfo("Steam").specificHeat).toBe(72);
		expect(GASES).toHaveLength(28);
	});

	it("match the catalogue's Ratio<Gas> logic types, one for one", () => {
		const ratios = Object.keys(loadCatalog().logicTypes).filter(
			(name) => /^Ratio.+/.test(name) && !/(Input2?|Output2?)$/.test(name),
		);
		expect(ratios.sort()).toEqual(GASES.map((g) => `Ratio${g.name}`).sort());
	});

	it("names the gases when one is unknown", () => {
		expect(() => gasInfo("Nitrogn")).toThrow(/Unknown gas "Nitrogn"; gases are Oxygen, Nitrogen/);
	});
});

describe("Mixture", () => {
	it("gives pressure from P = nRT/V", () => {
		const pipe = new Mixture({ volume: PIPE_VOLUME, temperature: 300, gases: { Nitrogen: 1 } });
		expect(pipe.pressure).toBeCloseTo((IDEAL_GAS_CONSTANT * 300) / 10, 9); // 249.4 kPa
		expect(pipe.totalMoles).toBe(1);
		expect(pipe.temperature).toBe(300);
	});

	it("gives each gas's ratio of the total moles", () => {
		const pipe = new Mixture({ volume: 100, temperature: 300, gases: { CarbonDioxide: 30, Nitrogen: 10 } });
		expect(pipe.ratio("CarbonDioxide")).toBe(0.75);
		expect(pipe.ratio("Nitrogen")).toBe(0.25);
		expect(pipe.ratio("Oxygen")).toBe(0);
		expect(pipe.gases()).toEqual({ Nitrogen: 10, CarbonDioxide: 30 });
	});

	it("is empty with no gas: zero pressure and ratios", () => {
		const pipe = new Mixture({ volume: 100, temperature: 300 });
		expect(pipe.pressure).toBe(0);
		expect(pipe.ratio("Nitrogen")).toBe(0);
		expect(pipe.totalMoles).toBe(0);
	});

	it("counts liquids in moles and ratios, but not pressure", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300, gases: { Nitrogen: 1, Water: 1 } });
		expect(pipe.pressure).toBeCloseTo(249.432, 3);
		expect(pipe.ratio("Water")).toBe(0.5);
	});

	it("can be made from a pressure and ratios", () => {
		const pipe = Mixture.fromPressure({ volume: 50, temperature: 280, pressure: 101.325, ratios: { Nitrogen: 7, Oxygen: 3 } });
		expect(pipe.pressure).toBeCloseTo(101.325, 9);
		expect(pipe.ratio("Nitrogen")).toBeCloseTo(0.7, 12);
	});

	it("mixes added gas in by heat capacity, not just moles", () => {
		const pipe = new Mixture({ volume: 10, temperature: 400, gases: { CarbonDioxide: 1 } });
		pipe.add("Nitrogen", 1, 300);
		expect(pipe.temperature).toBeCloseTo((28.2 * 400 + 20.6 * 300) / (28.2 + 20.6), 9); // 357.8 K, not 350
	});

	it("takes the gas's temperature when it was empty", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300 });
		pipe.add("Nitrogen", 2, 150);
		expect(pipe.temperature).toBe(150);
	});

	it("takes moles in proportion, conserving gas", () => {
		const pipe = new Mixture({ volume: 10, temperature: 320, gases: { CarbonDioxide: 30, Nitrogen: 10 } });
		const parcel = pipe.take(8);
		expect(parcel).toEqual({ gases: { CarbonDioxide: 6, Nitrogen: 2 }, temperature: 320 });
		expect(pipe.gases()).toEqual({ Nitrogen: 8, CarbonDioxide: 24 });
		expect(pipe.temperature).toBe(320);
	});

	it("takes everything when asked for more than it has", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300, gases: { Oxygen: 2 } });
		expect(pipe.take(5).gases).toEqual({ Oxygen: 2 });
		expect(pipe.totalMoles).toBe(0);
		expect(pipe.take(1).gases).toEqual({});
	});

	it("takes one gas, up to what it has", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300, gases: { Oxygen: 2, Nitrogen: 5 } });
		expect(pipe.takeGas("Oxygen", 3).gases).toEqual({ Oxygen: 2 });
		expect(pipe.gases()).toEqual({ Nitrogen: 5 });
	});

	it("warms and cools with heat", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300, gases: { Nitrogen: 2 } });
		pipe.addHeat(2 * 20.6 * 10);
		expect(pipe.temperature).toBeCloseTo(310, 9);
		pipe.addHeat(-1e9);
		expect(pipe.temperature).toBe(0);
	});

	it("changes pressure with temperature", () => {
		const pipe = new Mixture({ volume: 10, temperature: 300, gases: { Nitrogen: 1 } });
		const before = pipe.pressure;
		pipe.setTemperature(150);
		expect(pipe.pressure).toBeCloseTo(before / 2, 9);
	});

	it("rejects bad input", () => {
		expect(() => new Mixture({ volume: 0, temperature: 300 })).toThrow(/volume/);
		expect(() => new Mixture({ volume: Infinity, temperature: 300 })).toThrow(/volume/);
		expect(() => new Mixture({ volume: 10, temperature: -1 })).toThrow(/kelvin/);
		expect(() => new Mixture({ volume: 10, temperature: 300 }).add("Nitrogen", -1)).toThrow(/takeGas/);
	});
});

describe("Reservoir", () => {
	const outside = () => new Reservoir({ temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } });

	it("gives out gas at its composition and temperature without changing", () => {
		const air = outside();
		const parcel = air.take(10);
		expect(parcel.temperature).toBe(150);
		expect(parcel.gases.CarbonDioxide).toBeCloseTo(9.5, 12);
		expect(parcel.gases.Nitrogen).toBeCloseTo(0.5, 12);
		expect(air.pressure).toBe(20);
		expect(air.ratio("CarbonDioxide")).toBeCloseTo(0.95, 12);
	});

	it("absorbs gas and heat", () => {
		const air = outside();
		air.merge({ gases: { Oxygen: 100 }, temperature: 1000 }).addHeat(1e9);
		expect(air.temperature).toBe(150);
		expect(air.ratio("Oxygen")).toBe(0);
	});

	it("gives nothing when it's a vacuum", () => {
		const space = new Reservoir({ temperature: 3, pressure: 0, ratios: { Nitrogen: 1 } });
		expect(space.take(5).gases).toEqual({});
	});

	it("can change with the weather", () => {
		const air = outside().set({ temperature: 300, pressure: 30 });
		expect(air.temperature).toBe(300);
		expect(air.pressure).toBe(30);
	});
});

describe("exchangeHeat", () => {
	it("moves part of the way to a shared temperature, conserving energy", () => {
		const hot = new Mixture({ volume: 10, temperature: 400, gases: { CarbonDioxide: 2 } });
		const cold = new Mixture({ volume: 10, temperature: 200, gases: { Nitrogen: 3 } });
		const energy = () => hot.heatCapacity * hot.temperature + cold.heatCapacity * cold.temperature;
		const before = energy();
		const settled = before / (hot.heatCapacity + cold.heatCapacity);

		exchangeHeat(hot, cold, 0.5);
		expect(energy()).toBeCloseTo(before, 6);
		expect(hot.temperature).toBeCloseTo((400 + settled) / 2, 9);

		exchangeHeat(hot, cold, 1);
		expect(hot.temperature).toBeCloseTo(settled, 9);
		expect(cold.temperature).toBeCloseTo(settled, 9);
	});

	it("moves only the pipe toward a reservoir's temperature", () => {
		const pipe = new Mixture({ volume: 10, temperature: 400, gases: { CarbonDioxide: 2 } });
		const air = new Reservoir({ temperature: 150, pressure: 20, ratios: { CarbonDioxide: 1 } });
		exchangeHeat(pipe, air, 0.25);
		expect(pipe.temperature).toBeCloseTo(337.5, 9);
		expect(air.temperature).toBe(150);
	});

	it("does nothing with an empty side", () => {
		const pipe = new Mixture({ volume: 10, temperature: 400, gases: { CarbonDioxide: 2 } });
		exchangeHeat(pipe, new Mixture({ volume: 10, temperature: 100 }), 1);
		expect(pipe.temperature).toBe(400);
	});
});
