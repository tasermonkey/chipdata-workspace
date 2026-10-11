import { describe, expect, it } from "vitest";
import { GRID_VOLUME, IDEAL_GAS_CONSTANT, PIPE_VOLUME, sim, worldReport } from "../src/index.ts";

const READ = "l r0 d0 Pressure\nl r1 d0 Temperature\nl r2 d0 RatioCarbonDioxide\nyield\nj 0";

function analyzerWorld() {
	return sim()
		.pipe("waste", { volume: 10 * PIPE_VOLUME, temperature: 400, gases: { CarbonDioxide: 3, Nitrogen: 1 } })
		.device("pa", "StructurePipeAnalysizer", {}, { pipe: "waste" })
		.housing("ic", { code: READ, pins: { d0: "pa" } })
		.build();
}

describe("pipes", () => {
	it("give an attached pipe analyzer its readings", async () => {
		const world = await analyzerWorld();
		const pressure = (4 * IDEAL_GAS_CONSTANT * 400) / 100;
		expect(world.device("pa")).toHaveProps({
			Pressure: expect.closeTo(pressure, 9),
			Temperature: 400,
			TotalMoles: 4,
			RatioCarbonDioxide: 0.75,
			RatioNitrogen: 0.25,
			RatioOxygen: 0,
			Volume: 100,
		});

		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegisterCloseTo("r0", pressure, 9);
		expect(world.chip("ic")).toHaveRegister("r1", 400);
		expect(world.chip("ic")).toHaveRegister("r2", 0.75);
	});

	it("show a change made by a scripted event to chips in the same tick", async () => {
		const world = await analyzerWorld();
		world.at({ tick: 3 }, (w) => w.pipe("waste").setTemperature(300));
		await world.runTicks(3);
		expect(world.chip("ic")).toHaveRegister("r1", 400);
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r1", 300);
	});

	it("show a change made between ticks from the next tick, or at once with refreshReadings", async () => {
		const world = await analyzerWorld();
		world.pipe("waste").takeGas("Nitrogen", 1);
		expect(world.device("pa").get("RatioNitrogen")).toBe(0.25);
		world.refreshReadings();
		expect(world.device("pa").get("RatioNitrogen")).toBe(0);
		expect(world.device("pa").get("RatioCarbonDioxide")).toBe(1);
	});

	it("give a device its port readings by suffix", async () => {
		const world = await sim()
			.pipe("in", { volume: 50, temperature: 300, gases: { Nitrogen: 2, Oxygen: 2 } })
			.pipe("out", { volume: 50, temperature: 290, gases: { Nitrogen: 1 } })
			.pipe("waste", { volume: 50, temperature: 310, gases: { Oxygen: 1 } })
			.device("filter", "StructureFiltration", {}, { ports: { input: "in", output: "out", output2: "waste" } })
			.build();
		expect(world.device("filter")).toHaveProps({
			RatioNitrogenInput: 0.5,
			TemperatureOutput: 290,
			RatioNitrogenOutput: 1,
			RatioOxygenOutput2: 1,
			TotalMolesOutput2: 1,
		});
		expect(world.device("filter").port("input")).toBe(world.pipe("in"));
	});

	it("say which ports a device has when one gives it nothing", async () => {
		const build = sim()
			.pipe("coolant", { volume: 10, temperature: 150 })
			.device("vent", "StructureActiveVent", {}, { pipe: "coolant" })
			.build();
		await expect(build).rejects.toThrow(
			'sim: "vent": StructureActiveVent has no Pressure, so { pipe } gives it nothing; it has ports.output',
		);
	});
});

describe("rooms", () => {
	const outside = { temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } };

	it("give a gas sensor its room's readings, with moles per grid cell", async () => {
		const world = await sim()
			.room("outside", outside)
			.room("hall", { volume: 4 * GRID_VOLUME, temperature: 293, pressure: 100, ratios: { Nitrogen: 7, Oxygen: 3 } })
			.device("out", "StructureGasSensor", {}, { room: "outside" })
			.device("in", "StructureGasSensor", {}, { room: "hall" })
			.build();
		expect(world.device("out")).toHaveProps({
			Pressure: 20,
			Temperature: 150,
			RatioCarbonDioxide: expect.closeTo(0.95, 12),
			TotalMoles: expect.closeTo((20 * GRID_VOLUME) / (IDEAL_GAS_CONSTANT * 150), 9),
		});
		expect(world.device("in")).toHaveProps({
			Pressure: expect.closeTo(100, 9),
			TotalMoles: expect.closeTo(world.room("hall").totalMoles / 4, 9),
		});
	});

	it("are where a vent sits, without giving it readings", async () => {
		const world = await sim()
			.room("outside", outside)
			.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 150, pressure: 50, ratios: { CarbonDioxide: 1 } })
			.device("vent", "StructureActiveVent", {}, { ports: { output: "coolant" }, room: "outside" })
			.build();
		const vent = world.device("vent");
		expect(vent.room).toBe(world.room("outside"));
		expect(vent.port("output")).toBe(world.pipe("coolant"));
		expect(vent).toHaveProps({ PressureOutput: expect.closeTo(50, 9), TemperatureOutput: 150 });
		expect(vent.readings).not.toContain("PressureExternal");
	});
});

describe("readings from an atmosphere", () => {
	it("can't be set on the device", async () => {
		const world = await analyzerWorld();
		expect(() => world.device("pa").set("Pressure", 50)).toThrow(
			'"pa".Pressure comes from pipe "waste", so it can\'t be set on the device; change world.pipe("waste") instead',
		);
		world.device("pa").set("On", 0); // a setting, not a reading
	});

	it("can't be given by hand when building", async () => {
		const build = sim()
			.pipe("waste", { volume: 10, temperature: 300 })
			.device("pa", "StructurePipeAnalysizer", { Pressure: 50 }, { pipe: "waste" })
			.build();
		await expect(build).rejects.toThrow(/"pa": Pressure comes from pipe "waste", so it can't be set on the device/);
	});

	it("leave devices with nothing attached as they were", async () => {
		const world = await sim().device("pa", "StructurePipeAnalysizer", { Pressure: 50 }).build();
		world.device("pa").set("Pressure", 60);
		expect(world.device("pa").get("Pressure")).toBe(60);
		expect(world.device("pa").readings).toEqual([]);
	});
});

describe("building with atmospheres", () => {
	it("rejects unknown and mismatched keys", async () => {
		await expect(sim().device("pa", "StructurePipeAnalysizer", {}, { pipe: "nope" }).build()).rejects.toThrow(
			'sim: "pa" { pipe }: no pipe "nope"',
		);
		await expect(
			sim()
				.room("hall", { volume: 8000, temperature: 293 })
				.device("pa", "StructurePipeAnalysizer", {}, { pipe: "hall" })
				.build(),
		).rejects.toThrow('"hall" is a room, not a pipe');
		await expect(
			sim().pipe("pa", { volume: 10, temperature: 300 }).device("pa", "StructurePipeAnalysizer").build(),
		).rejects.toThrow('sim: "pa" is declared twice');
	});

	it("needs a volume for a pipe, and ratios for outside air", () => {
		expect(() => sim().pipe("p", { temperature: 300, pressure: 10, ratios: { Nitrogen: 1 } } as never)).toThrow(/needs a volume/);
		expect(() => sim().room("r", { temperature: 300, gases: { Nitrogen: 1 } } as never)).toThrow(/outside air/);
	});
});

describe("world values", () => {
	it("include pipes and rooms by path, in snapshots and recordings", async () => {
		const world = await analyzerWorld();
		expect(world.value("waste.Temperature")).toBe(400);
		expect(world.value("waste.CarbonDioxide")).toBe(3);
		expect(world.value("waste.RatioNitrogen")).toBe(0.25);
		expect(world.snapshot().values).toMatchObject({ "waste.Temperature": 400, "waste.TotalMoles": 4 });
		expect(() => world.value("waste.Colour")).toThrow(/pipe "waste" has no value "Colour"/);

		const temperature = world.record("waste.Temperature");
		world.every({ ticks: 1 }, (w) => w.pipe("waste").setTemperature(w.pipe("waste").temperature - 10), {
			start: { tick: 0 },
		});
		await world.runTicks(2);
		expect(temperature.values).toEqual([400, 390, 380]);

		const before = world.snapshot();
		world.pipe("waste").add("Nitrogen", 1);
		expect(world.diff(before).map((c) => c.path)).toEqual(
			expect.arrayContaining(["waste.TotalMoles", "waste.Pressure", "waste.RatioNitrogen"]),
		);
	});

	it("show in failure reports", async () => {
		const world = await analyzerWorld();
		expect(worldReport(world)).toContain("pipes and rooms:\n  waste  pipe 100 L: 133 kPa, 400 K, 4 mol, Nitrogen 25.0%, CarbonDioxide 75.0%");
	});
});
