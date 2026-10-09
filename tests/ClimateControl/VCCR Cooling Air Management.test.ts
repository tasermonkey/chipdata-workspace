import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
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

		expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
		expect(world.chip("ic")).toHaveRegister("OutsideTemp", 300);
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toNeverAutoYield();
	});

	it("turns the vent off at night once the pipe reaches max pressure", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 41_000 });
		await world.runTicks(SETTLE_TICKS);

		expect(world.device("vent")).toHaveProps({ Mode: 1, On: 0 });
	});

	it("by day, vents outward only while the pipe is hotter than 180 °C", async () => {
		const hot = await build({ outsideTemp: 500, pipeTemp: 500, pipePressure: 1000 });
		await hot.runTicks(SETTLE_TICKS);
		expect(hot.device("vent")).toHaveProps({ Mode: 0, On: 1 });

		const cool = await build({ outsideTemp: 500, pipeTemp: 400, pipePressure: 1000 });
		await cool.runTicks(SETTLE_TICKS);
		expect(cool.device("vent")).toHaveProps({ Mode: 0, On: 0 });
	});

	it("switches to day mode when day comes", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 500, pipePressure: 1000 });
		world.at({ tick: 10 }, (w) => w.device("sensor").set("Temperature", 450));
		const mode = world.record("vent.Mode");

		await world.runUntil((w) => w.device("vent").get("Mode") === 1, { maxTicks: 5 });
		await world.runUntil((w) => w.device("vent").get("Mode") === 0, { maxTicks: 20 });

		expect(world.tick).toBe(12); // the sensor reads 450 in tick 10; the vent switches in tick 11
		expect(mode).toToggleAtMost(2); // unset (0) → night (1) → day (0)
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("shows the pipe temperature on the housing", async () => {
		const world = await build({ outsideTemp: 300, pipeTemp: 432.5, pipePressure: 1000 });
		await world.runTicks(SETTLE_TICKS);
		expect(world.db("ic")).toHaveProps({ Setting: 432.5 });
	});
});
