// Data breakpoints ("Break on Value Change"): see data-breakpoints.ic10.
import { sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

describe("data breakpoints", () => {
	it("heats through a cold snap, then idles once the sun is up", async () => {
		const world = await sim({ root: import.meta.dirname })
			.device("heater", "StructureWallHeater")
			.device("sensor", "StructureGasSensor", { Temperature: 285 })
			.housing("ic", { file: "data-breakpoints.ic10", pins: { d0: "heater", d1: "sensor" } })
			.build();
		world.at({ tick: 5 }, (w) => w.device("sensor").set("Temperature", 270), { label: "cold snap" });
		world.at({ tick: 15 }, (w) => w.device("sensor").set("Temperature", 300), { label: "sunrise" });
		const heater = world.record("heater.On");

		await world.runTicks(20);

		expect(heater).toToggleAtMost(2); // off, on in the cold snap, off at sunrise
		expect(world.device("heater")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveRegister("Stage", 2);
		expect(world.chip("ic")).toHaveStackAt(0, 270);
	});
});
