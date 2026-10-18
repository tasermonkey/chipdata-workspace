import { describe, expect, it } from "vitest";
import { activeVent, heatExchange, PIPE_VOLUME, sim, VentMode } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";
import { reachStage } from "../support/stage.ts";

const SCRIPT = "ic10/ClimateControl/IC Cooler.ic10";

/** Temperatures in kelvin; the script starts cooling at 303 K and stops below 290 K. */
function build(world: { gasTemp: number; outsidePressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("source", "StructurePipeAnalysizer", { Temperature: world.gasTemp })
		.device("atmo", "StructurePipeAnalysizer", { Pressure: world.outsidePressure })
		.device("vent", "StructureActiveVent")
		.housing("ic", { file: SCRIPT, pins: { d0: "source", d1: "atmo", d2: "vent" } })
		.build();
}

// Active Vent modes (Stationpedia): 0 Outward pushes pipe gas out into the room, 1 Inward pulls
// room gas into the pipe. Here the room is outside and the pipe is the coolant pipe (atmo).
describe("IC Cooler", () => {
	// Cooling once used Outward, which pushed the coolant out instead of drawing it in.
	it("starts cooling once the gas is warm, drawing cold outside air in (Inward)", async () => {
		const world = await build({ gasTemp: 310, outsidePressure: 0 });
		await reachStage(world, 2, { maxTicks: 30 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Inward, On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// Emptying once used Inward, which kept filling the coolant pipe.
	it("empties the coolant pipe back outside (Outward) once cooling is done", async () => {
		const world = await build({ gasTemp: 280, outsidePressure: 50 });
		await world.runTicks(3);

		expect(world.chip("ic")).toHaveRegister("Stage", 0);
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// The thresholds are MAX_TEMP 303 K and MIN_TEMP 290 K.
	it("waits until the gas reaches 303 K, and cools until it's below 290 K", async () => {
		const world = await build({ gasTemp: 302, outsidePressure: 0 });
		await reachStage(world, 1, { maxTicks: 30 });
		await world.runSeconds(20);
		expect(world.chip("ic")).toHaveRegister("Stage", 1);

		world.device("source").set("Temperature", 303);
		await reachStage(world, 2, { maxTicks: 30 });

		world.device("source").set("Temperature", 290);
		await world.runSeconds(5);
		expect(world.chip("ic")).toHaveRegister("Stage", 2);

		world.device("source").set("Temperature", 289);
		await reachStage(world, 0, { maxTicks: 10 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// `move stage 0` once used the alias with the wrong case.
	it("goes back to waiting (Stage 0) once the gas has cooled, without an error", async () => {
		const world = await build({ gasTemp: 310, outsidePressure: 0 });
		await reachStage(world, 2, { maxTicks: 30 });

		world.device("source").set("Temperature", 280);
		world.device("atmo").set("Pressure", 50); // the outside-air pipe still holds air from cooling
		await world.runTicks(3);

		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toHaveRegister("Stage", 0);
	});

	// Stage 0 once waited for the outside-air pipe to read exactly 0 kPa.
	it("counts the outside-air pipe as empty at EMPTY_KPA (1 kPa) or below", async () => {
		const world = await build({ gasTemp: 280, outsidePressure: 1.5 });
		await world.runTicks(6);
		expect(world.chip("ic")).toHaveRegister("Stage", 0); // not empty yet

		world.device("atmo").set("Pressure", 0.4);
		await reachStage(world, 1, { maxTicks: 10 });
		await world.runTicks(1); // the vent goes off after the stage changes, past a yield
		expect(world.device("vent")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});

/**
 * The build with gas in it: hot CO2 from the furnaces in a pipe (PA_SRC), a coolant pipe (PA_ATMO)
 * that the vent fills from the cold outside, and a radiator passing heat between them. The numbers
 * are illustrative, not from the save.
 */
async function buildWithGas() {
	const world = await sim({ root: REPO_ROOT })
		.room("outside", { temperature: 120, pressure: 30, ratios: { Nitrogen: 1 } })
		.pipe("waste", { volume: 20 * PIPE_VOLUME, temperature: 330, pressure: 2000, ratios: { CarbonDioxide: 1 } })
		.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 120 })
		.device("source", "StructurePipeAnalysizer", {}, { pipe: "waste" })
		.device("atmo", "StructurePipeAnalysizer", {}, { pipe: "coolant" })
		.device("vent", "StructureActiveVent", {}, { ports: { output: "coolant" }, room: "outside" })
		.housing("ic", { file: SCRIPT, pins: { d0: "source", d1: "atmo", d2: "vent" } })
		.build();
	world.model("vent", activeVent());
	world.model(heatExchange("coolant", "waste", { fraction: 0.1 }));
	return world;
}

describe("IC Cooler, with gas", () => {
	it("cools the hot gas below 290 K by drawing cold outside air through the radiator", async () => {
		const world = await buildWithGas();
		await reachStage(world, 2, { maxTicks: 30 });
		const start = world.tick;
		const waste = world.record("waste.Temperature");

		await reachStage(world, 0, { maxTicks: 120 });
		expect(world.pipe("waste").temperature).toBeLessThan(290);
		expect(world.tick - start).toBeLessThan(60);
		// It only ever falls while cooling.
		for (let i = 1; i < waste.values.length; i++) expect(waste.values[i]).toBeLessThanOrEqual(waste.values[i - 1]!);
		expect(world.pipe("coolant").pressure).toBeGreaterThan(30); // full of outside air
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("then empties the coolant pipe back outside and switches the vent off", async () => {
		const world = await buildWithGas();
		await reachStage(world, 2, { maxTicks: 30 });
		await reachStage(world, 0, { maxTicks: 120 });
		await world.runTicks(2); // stage 0 sets Outward on its next pass
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 1 });
		const full = world.pipe("coolant").pressure;

		await world.runTicks(2);
		expect(world.pipe("coolant").pressure).toBeLessThan(full); // draining
		await reachStage(world, 1, { maxTicks: 200 });
		expect(world.pipe("coolant").pressure).toBeLessThanOrEqual(1);
		await world.runTicks(2);
		expect(world.device("vent")).toHaveProps({ On: 0 });
		expect(world.pipe("waste").temperature).toBeLessThan(290);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
