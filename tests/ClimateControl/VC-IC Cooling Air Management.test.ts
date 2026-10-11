import { describe, expect, it } from "vitest";
import { activeVent, heatExchange, PIPE_VOLUME, sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/VC-IC Cooling Air Management [498974].ic10";

/**
 * The vent's PressureInternal is its configured limit, not a reading; it's set here to something
 * other than the pipe pressure so a script reading the wrong one is caught.
 */
function build(pipe: { temp: number; pressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("vent", "StructureActiveVent", {
			TemperatureOutput: pipe.temp,
			PressureOutput: pipe.pressure,
			PressureInternal: 1000,
		})
		.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent" } })
		.build();
}

const HOT = 450; // above MAX_PIPE_TEMP, 419.15 K
const COOL = 400;

// CODE_REVIEW.md 1.4: it read the vent's PressureInternal setting, and expelled only below 500 kPa.
describe("VC-IC Cooling Air Management", () => {
	it("expels a hot pipe that is well above the 500 kPa floor", async () => {
		const world = await build({ temp: HOT, pressure: 5000 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("keeps at least 500 kPa in the pipe, however hot", async () => {
		const world = await build({ temp: HOT, pressure: 300 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ On: 0 });
	});

	it("leaves a cool pipe alone", async () => {
		const world = await build({ temp: COOL, pressure: 5000 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ On: 0 });
	});
});

/** Ticks between the script's checks: a yield and a 5 s sleep. */
const CHECK_TICKS = 11;

/**
 * The build with gas in it: a hot CO2 pipe, the vent expelling it to the outside air, and
 * optionally a radiator to a cold pipe. Vulcan-like air; the numbers are illustrative.
 */
async function buildWithGas(options: { segments: number; pressure: number; radiator?: boolean }) {
	let builder = sim({ root: REPO_ROOT })
		.room("outside", { temperature: 500, pressure: 60, ratios: { CarbonDioxide: 1 } })
		.pipe("exchange", { volume: options.segments * PIPE_VOLUME, temperature: HOT, pressure: options.pressure, ratios: { CarbonDioxide: 1 } })
		.device("vent", "StructureActiveVent", {}, { ports: { output: "exchange" }, room: "outside" })
		.housing("ic", { file: SCRIPT, prefab: "StructureCircuitHousingCompact", pins: { d0: "vent" } });
	if (options.radiator) builder = builder.pipe("cold", { volume: 100_000, temperature: 300, pressure: 1000, ratios: { CarbonDioxide: 1 } });
	const world = await builder.build();
	world.model("vent", activeVent());
	if (options.radiator) world.model(heatExchange("exchange", "cold", { fraction: 0.05 }));
	return world;
}

describe("VC-IC Cooling Air Management, with gas", () => {
	it("expels a hot pipe down to about 500 kPa, then leaves it", async () => {
		const world = await buildWithGas({ segments: 500, pressure: 2000 });
		const pipe = world.pipe("exchange");
		await world.runTicks(2);
		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });

		await world.runUntil((w) => w.device("vent").get("On") === 0, { maxTicks: 300 });
		// The script checks every 5.5 s, so the vent can run past 500 kPa for up to one interval.
		const perTick = 16; // 10 kPa of a grid cell (8000 L) a tick, into 5000 L
		expect(pipe.pressure).toBeLessThanOrEqual(500);
		expect(pipe.pressure).toBeGreaterThan(500 - CHECK_TICKS * perTick);
		const left = pipe.pressure;
		await world.runTicks(3 * CHECK_TICKS);
		expect(pipe.pressure).toBe(left);
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("stops expelling once a radiator has cooled the pipe below 146 °C", async () => {
		const world = await buildWithGas({ segments: 500, pressure: 5000, radiator: true });
		const pipe = world.pipe("exchange");
		await world.runUntil((w) => w.device("vent").get("On") === 1, { maxTicks: 5 });
		await world.runUntil((w) => w.device("vent").get("On") === 0, { maxTicks: 100 });

		expect(pipe.temperature).toBeLessThan(419.15);
		expect(pipe.pressure).toBeGreaterThan(4000); // stopped by the temperature, not the floor
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
