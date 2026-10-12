// Step Tick, Run N Ticks and Run Until Event: see ticks.ic10. The labelled events are what
// Run Until Event offers.
import { sim } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

describe("ticks", () => {
	it("lights up at dusk while the battery has charge to spare", async () => {
		const world = await sim({ root: import.meta.dirname })
			.device("sensor", "StructureGasSensor", { Temperature: 290 })
			.device("light", "StructureWallLight")
			.device("battery", "StructureBattery", { Charge: 5000 })
			.housing("ic", { file: "ticks.ic10", pins: { d0: "sensor", d1: "light", d2: "battery" } })
			.build();
		world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 250), { label: "dusk" });
		world.every({ ticks: 15 }, (w) => w.device("battery").add("Charge", -1000), { label: "drain" });
		world.when(
			(w) => w.device("battery").get("Charge") < 2500,
			(w) => w.device("battery").set("Charge", 10_000),
			{ label: "generator" },
		);
		const light = world.record("light.On");

		await world.runTicks(60);

		expect(world.chip("ic")).toHaveRegister("Phase", 2);
		// Dark until dusk at tick 20 (sampled at its end). The drain at tick 45 takes the charge to
		// 2000, but the generator tops it up in the same tick, before the chip runs, so it stays on.
		expect(light.ticks[light.values.indexOf(1)]).toBe(21);
		expect(light).toToggleAtMost(1);
		expect(world.device("battery")).toHaveProps({ Charge: 10_000 });
	});
});
