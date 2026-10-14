import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/FoodControl/Grow Lights.ic10";

/** A daylight sensor on d0 (unless `sensor` is false) and `lights` grow lights on the network. */
function build(vertical: number, { lights = 2, sensor = true } = {}) {
	let builder = sim({ root: REPO_ROOT });
	if (sensor) builder = builder.device("sensor", "StructureDaylightSensor", { Vertical: vertical });
	return builder
		.devices(Array.from({ length: lights }, (_, i) => [`light${i + 1}`, "StructureGrowLight"] as const))
		.device("wallLight", "StructureWallLight")
		.housing("ic", { file: SCRIPT, pins: sensor ? { d0: "sensor" } : {} })
		.build();
}

describe("Grow Lights", () => {
	it("turns every grow light on while the sun's vertical angle is 100 or less", async () => {
		const world = await build(100);
		await world.runTicks(1);
		expect(world.device("light1")).toHaveProps({ On: 1 });
		expect(world.device("light2")).toHaveProps({ On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns them off above 100, and on again when it drops", async () => {
		const world = await build(101);
		await world.runTicks(1);
		expect(world.device("light1")).toHaveProps({ On: 0 });

		world.device("sensor").set("Vertical", 60);
		await world.runSeconds(2); // it checks about once every 1.5 s
		expect(world.device("light1")).toHaveProps({ On: 1 });
		expect(world.device("light2")).toHaveProps({ On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("switches at exactly 100: on at 100, off just above it", async () => {
		const world = await build(100);
		await world.runTicks(1);
		expect(world.device("light1")).toHaveProps({ On: 1 });

		world.device("sensor").set("Vertical", 100.01);
		await world.runUntil((w) => w.device("light1").get("On") === 0, { maxTicks: 10 });

		world.device("sensor").set("Vertical", 100);
		await world.runUntil((w) => w.device("light1").get("On") === 1, { maxTicks: 10 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("switches every grow light on the network, and no other light", async () => {
		const world = await build(50, { lights: 5 });
		await world.runTicks(1);
		for (let i = 1; i <= 5; i++) expect(world.device(`light${i}`)).toHaveProps({ On: 1 });
		expect(world.device("wallLight")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns the lights off when the sensor reads NaN", async () => {
		const world = await build(50);
		await world.runTicks(1);
		world.device("sensor").set("Vertical", NaN);
		await world.runUntil((w) => w.device("light1").get("On") === 0, { maxTicks: 10 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("halts on its first line without a sensor on d0, leaving the lights alone", async () => {
		const world = await build(50, { sensor: false });
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveHalted({ line: 5 }); // l lightSensorValue LightSensor Vertical
		expect(world.device("light1")).toHaveProps({ On: 0 });
	});
});
