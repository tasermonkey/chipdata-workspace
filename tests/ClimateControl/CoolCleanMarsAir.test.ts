import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

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
});
