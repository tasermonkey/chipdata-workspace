import { describe, expect, it } from "vitest";
import { activeVent, dayNight, heatExchange, PIPE_VOLUME, sim, VentMode } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/VCCR Cooling Air Management (1) [22840].ic10";

/** Temperatures in kelvin; the script's thresholds are 408 K (night) and 453 K (pipe). */
function build(world: { outsideTemp: number; pipeTemp: number; pipePressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("vent", "StructureActiveVent", {
			TemperatureOutput: world.pipeTemp,
			PressureOutput: world.pipePressure,
		})
		.device("sensor", "StructureGasSensor", { Temperature: world.outsideTemp })
		.housing("ic", {
			file: SCRIPT,
			prefab: "StructureCircuitHousingCompact",
			pins: { d0: "vent", d1: "sensor" },
		})
		.build();
}

// The loop yields at the top and again inside each mode, so the vent is fully set in the third tick.
const SETTLE_TICKS = 3;

describe("VCCR Cooling Air Management", () => {
	it("pulls in night air while the pipe is under max pressure", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 1000 });
		await world.runTicks(SETTLE_TICKS);

		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Inward, On: 1 });
		expect(world.chip("ic")).toHaveRegister("OutsideTemp", 300);
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toNeverAutoYield();
	});

	it("turns the vent off at night once the pipe reaches max pressure", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 41_000 });
		await world.runTicks(SETTLE_TICKS);

		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Inward, On: 0 });
	});

	it("by day, vents outward only while the pipe is hotter than 180 °C", async () => {
		const hot = await build({ outsideTemp: 500, pipeTemp: 500, pipePressure: 1000 });
		await hot.runTicks(SETTLE_TICKS);
		expect(hot.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 1 });

		const cool = await build({ outsideTemp: 500, pipeTemp: 400, pipePressure: 1000 });
		await cool.runTicks(SETTLE_TICKS);
		expect(cool.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 0 });
	});

	it("switches to day mode when day comes", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 1000 });
		world.at({ tick: 10 }, (w) => w.device("sensor").set("Temperature", 450));
		const mode = world.record("vent.Mode");

		await world.runUntil((w) => w.device("vent").get("Mode") === VentMode.Inward, { maxTicks: 5 });
		await world.runUntil((w) => w.device("vent").get("Mode") === VentMode.Outward, { maxTicks: 20 });

		expect(world.tick).toBe(12); // the sensor reads 450 in tick 10; the vent switches in tick 11
		expect(mode).toToggleAtMost(2); // unset (0) → night (1) → day (0)
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// With no reading, both comparisons once failed and it fell into night mode.
	it("turns the vent off when the outside sensor reads NaN", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 1000 });
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ On: 1 });

		world.device("sensor").set("Temperature", NaN);
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns the vent off, and keeps running, with no sensor on d1", async () => {
		const world = await sim({ root: REPO_ROOT })
			.device("vent", "StructureActiveVent", { On: 1, TemperatureOutput: 500, PressureOutput: 1000 })
			.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent" } })
			.build();
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("shows the pipe temperature on the housing", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 432.5, pipePressure: 1000 });
		await world.runTicks(SETTLE_TICKS);
		expect(world.db("ic")).toHaveProps({ Setting: 432.5 });
	});
});

const NIGHT_TEMP_MAX = 408;
const MAX_TEMP_IN_PIPE = 453;

/**
 * The build with gas in it: Vulcan-like outside air whose temperature follows a short day (600
 * ticks, from midnight), a 100-segment pipe of CO2, and the pipe trading heat with the outside air.
 * The numbers are illustrative, not from the save.
 */
async function buildWithGas() {
	const world = await sim({ root: REPO_ROOT })
		.room("outside", { temperature: 350, pressure: 60, ratios: { CarbonDioxide: 1 } })
		.pipe("store", { volume: 100 * PIPE_VOLUME, temperature: 350, pressure: 1000, ratios: { CarbonDioxide: 1 } })
		.device("vent", "StructureActiveVent", {}, { ports: { output: "store" }, room: "outside" })
		.device("sensor", "StructureGasSensor", {}, { room: "outside" })
		.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent", d1: "sensor" } })
		.build();
	world.model(dayNight({ dayTicks: 600, room: "outside", temperature: { night: 350, day: 600 } }));
	world.model("vent", activeVent());
	world.model(heatExchange("store", "outside", { fraction: 0.05 }));
	return world;
}

describe("VCCR Cooling Air Management, with gas", () => {
	it("fills the pipe at night, holds it in the morning, and expels it once the day heats it", async () => {
		const world = await buildWithGas();
		const outside = () => world.room("outside").temperature;
		const store = world.pipe("store");

		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Inward, On: 1 }); // night: filling
		const atStart = store.pressure;

		await world.runUntil(() => outside() > NIGHT_TEMP_MAX, { maxTicks: 200 });
		const filled = store.pressure;
		expect(filled).toBeGreaterThan(atStart + 5000);
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 0 }); // morning: the pipe isn't hot yet

		await world.runUntil(() => store.temperature > MAX_TEMP_IN_PIPE, { maxTicks: 200 });
		expect(store.pressure).toBeGreaterThanOrEqual(filled); // held (and warmed)
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Outward, On: 1 }); // hot: expelling
		const hot = store.pressure;
		await world.runTicks(20);
		expect(store.pressure).toBeLessThan(hot);
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("fills again the next night", async () => {
		const world = await buildWithGas();
		await world.runTicks(300); // noon
		await world.runUntil(() => world.room("outside").temperature <= NIGHT_TEMP_MAX, { maxTicks: 300 });
		await world.runTicks(SETTLE_TICKS);
		expect(world.device("vent")).toHaveProps({ Mode: VentMode.Inward, On: 1 });
		const before = world.pipe("store").pressure;
		await world.runTicks(20);
		expect(world.pipe("store").pressure).toBeGreaterThan(before);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
