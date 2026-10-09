import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/Alaska IC Cooler [101290].ic10";

// Predicates read Stage as r15: they run before the script has defined its aliases.

/** Temperatures in kelvin; the script starts cooling at 303 K and stops below 290 K. */
function build(world: { gasTemp: number; outsidePressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("source", "StructurePipeAnalysizer", { Temperature: world.gasTemp })
		.device("atmo", "StructurePipeAnalysizer", { Pressure: world.outsidePressure })
		.device("vent", "StructureActiveVent")
		.housing("ic", { file: SCRIPT, pins: { d0: "source", d1: "atmo", d2: "vent" } })
		.build();
}

describe("Alaska IC Cooler", () => {
	it("starts cooling once the gas is warm", async () => {
		const world = await build({ gasTemp: 310, outsidePressure: 0 });
		await world.runUntil((w) => w.chip("ic").reg("r15") === 2, { maxTicks: 30 });
		await world.runTicks(2);

		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 1.2: the thresholds are MAX_TEMP 303 K and MIN_TEMP 290 K.
	it("waits until the gas reaches 303 K, and cools until it's below 290 K", async () => {
		const world = await build({ gasTemp: 302, outsidePressure: 0 });
		await world.runUntil((w) => w.chip("ic").reg("r15") === 1, { maxTicks: 30 });
		await world.runSeconds(20);
		expect(world.chip("ic")).toHaveRegister("Stage", 1);

		world.device("source").set("Temperature", 303);
		await world.runUntil((w) => w.chip("ic").reg("r15") === 2, { maxTicks: 30 });

		world.device("source").set("Temperature", 290);
		await world.runSeconds(5);
		expect(world.chip("ic")).toHaveRegister("Stage", 2);

		world.device("source").set("Temperature", 289);
		await world.runUntil((w) => w.chip("ic").reg("r15") === 0, { maxTicks: 10 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 1.1: `move stage 0` used the alias with the wrong case.
	it("goes back to waiting (Stage 0) once the gas has cooled, without an error", async () => {
		const world = await build({ gasTemp: 310, outsidePressure: 0 });
		await world.runUntil((w) => w.chip("ic").reg("r15") === 2, { maxTicks: 30 });

		world.device("source").set("Temperature", 280);
		world.device("atmo").set("Pressure", 50); // the outside-air pipe still holds air from cooling
		await world.runTicks(3);

		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toHaveRegister("Stage", 0);
	});
});
