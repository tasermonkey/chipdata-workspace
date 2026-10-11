/**
 * Tests with gas shared by VCCR Cooling Air Management and VC-IC Cold Night Extraction, which run
 * the same logic: at night (outside at 408 K or below) a vent fills a pipe with outside air up to
 * 41,000 kPa; by day it expels the pipe's gas while the pipe is above 453 K.
 */
import { describe, expect, it } from "vitest";
import { activeVent, dayNight, heatExchange, PIPE_VOLUME, sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const NIGHT_TEMP_MAX = 408;
const MAX_TEMP_IN_PIPE = 453;
/** Ticks for the script to see a change and set the vent: it yields twice a pass. */
const SETTLE = 3;

/**
 * Vulcan-like outside air whose temperature follows a short day (600 ticks, from midnight), a
 * 100-segment pipe of CO2, and the pipe trading heat with the outside air. The numbers are
 * illustrative, not from the save.
 */
async function build(script: string) {
	const world = await sim({ root: REPO_ROOT })
		.room("outside", { temperature: 350, pressure: 60, ratios: { CarbonDioxide: 1 } })
		.pipe("store", { volume: 100 * PIPE_VOLUME, temperature: 350, pressure: 1000, ratios: { CarbonDioxide: 1 } })
		.device("vent", "StructureActiveVent", {}, { ports: { output: "store" }, room: "outside" })
		.device("sensor", "StructureGasSensor", {}, { room: "outside" })
		.housing("ic", { file: script, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent", d1: "sensor" } })
		.build();
	world.model(dayNight({ dayTicks: 600, room: "outside", temperature: { night: 350, day: 600 } }));
	world.model("vent", activeVent());
	world.model(heatExchange("store", "outside", { fraction: 0.05 }));
	return world;
}

export function describeNightAirWithGas(name: string, script: string) {
	describe(`${name}, with gas`, () => {
		it("fills the pipe at night, holds it in the morning, and expels it once the day heats it", async () => {
			const world = await build(script);
			const outside = () => world.room("outside").temperature;
			const store = world.pipe("store");

			await world.runTicks(SETTLE);
			expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 }); // night: filling
			const atStart = store.pressure;

			await world.runUntil(() => outside() > NIGHT_TEMP_MAX, { maxTicks: 200 });
			const filled = store.pressure;
			expect(filled).toBeGreaterThan(atStart + 5000);
			await world.runTicks(SETTLE);
			expect(world.device("vent")).toHaveProps({ Mode: 0, On: 0 }); // morning: the pipe isn't hot yet

			await world.runUntil(() => store.temperature > MAX_TEMP_IN_PIPE, { maxTicks: 200 });
			expect(store.pressure).toBeGreaterThanOrEqual(filled); // held (and warmed)
			await world.runTicks(SETTLE);
			expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 }); // hot: expelling
			const hot = store.pressure;
			await world.runTicks(20);
			expect(store.pressure).toBeLessThan(hot);
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("fills again the next night", async () => {
			const world = await build(script);
			await world.runTicks(300); // noon
			await world.runUntil(() => world.room("outside").temperature <= NIGHT_TEMP_MAX, { maxTicks: 300 });
			await world.runTicks(SETTLE);
			expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
			const before = world.pipe("store").pressure;
			await world.runTicks(20);
			expect(world.pipe("store").pressure).toBeGreaterThan(before);
			expect(world.chip("ic")).toHaveNoErrors();
		});
	});
}
