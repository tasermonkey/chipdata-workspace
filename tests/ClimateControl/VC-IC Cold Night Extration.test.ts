import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/VC-IC Cold Night Extration [371458].ic10";

/** The vent on d0 fills or empties the pipe; the gas sensor on d1 reads the outside. Kelvin, kPa. */
function build(world: { outside: number; pipeTemp: number; pipePressure: number }) {
	return sim({ root: REPO_ROOT })
		.device("vent", "StructureActiveVent", { TemperatureOutput: world.pipeTemp, PressureOutput: world.pipePressure })
		.device("sensor", "StructureGasSensor", { Temperature: world.outside })
		.housing("ic", { file: SCRIPT, pins: { d0: "vent", d1: "sensor" } })
		.build();
}

describe("VC-IC Cold Night Extraction", () => {
	it("at night (127 °C or below outside) pulls air into the pipe", async () => {
		const world = await build({ outside: 300, pipeTemp: 350, pipePressure: 10000 });
		await world.runTicks(3);
		expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
		expect(world.db("ic")).toHaveProps({ Setting: 350 }); // shows the pipe temperature
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("stops pulling once the pipe reaches 41,000 kPa", async () => {
		const world = await build({ outside: 300, pipeTemp: 350, pipePressure: 41000 });
		await world.runTicks(3);
		expect(world.device("vent")).toHaveProps({ Mode: 1, On: 0 });
	});

	it("by day expels the pipe's gas only while it's above 180 °C", async () => {
		const world = await build({ outside: 450, pipeTemp: 460, pipePressure: 10000 });
		await world.runTicks(3);
		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });

		world.device("vent").set("TemperatureOutput", 440);
		await world.runTicks(3);
		expect(world.device("vent")).toHaveProps({ Mode: 0, On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
