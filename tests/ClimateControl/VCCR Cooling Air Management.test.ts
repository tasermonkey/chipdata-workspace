import type { EnvSchema } from "@stationeers-ic/ic10";
import { describe, expect, it } from "vitest";
import { createEnv } from "@tasermonkey/ic10-test";
import { readRepoScript } from "../support/paths.ts";

const SCRIPT = "ic10/ClimateControl/VCCR Cooling Air Management (1) [22840].ic10";
const HOUSING = 100;
const VENT = 200;
const SENSOR = 300;

function setup(world: { outsideTemp: number; pipeTemp: number; pipePressure: number }) {
	const env = {
		version: 1,
		chips: [{ id: 1, code: readRepoScript(SCRIPT) }],
		networks: [{ id: "data", type: "data" }],
		devices: [
			{
				id: HOUSING,
				PrefabName: "StructureCircuitHousingCompact",
				chip: 1,
				ports: [{ port: "default", network: "data" }],
				pins: [
					{ pin: "d0", device: VENT },
					{ pin: "d1", device: SENSOR },
				],
			},
			{
				id: VENT,
				PrefabName: "StructureActiveVent",
				ports: [{ port: "default", network: "data" }],
				props: [
					{ name: "TemperatureOutput", value: world.pipeTemp },
					{ name: "PressureOutput", value: world.pipePressure },
				],
			},
			{
				id: SENSOR,
				PrefabName: "StructureGasSensor",
				ports: [{ port: "default", network: "data" }],
				props: [{ name: "Temperature", value: world.outsideTemp }],
			},
		],
	} as EnvSchema;
	return createEnv(env, HOUSING);
}

describe("VCCR Cooling Air Management", () => {
	it("at night, vents inward (Mode 1) while the pipe is under max pressure", async () => {
		const env = setup({ outsideTemp: 300, pipeTemp: 500, pipePressure: 1000 });
		expect(await env.run(200)).toBe(200);

		const vent = env.device(VENT).props!;
		expect(vent.read("Mode")).toBe(1);
		expect(vent.read("On")).toBe(1);
		expect(env.runner.context.errors).toEqual([]);
	});

	it("at night, turns the vent off once the pipe reaches max pressure", async () => {
		const env = setup({ outsideTemp: 300, pipeTemp: 500, pipePressure: 41_000 });
		await env.run(200);

		const vent = env.device(VENT).props!;
		expect(vent.read("Mode")).toBe(1);
		expect(vent.read("On")).toBe(0);
	});

	it("by day, vents outward (Mode 0) only while the pipe is hotter than 180 °C", async () => {
		const hot = setup({ outsideTemp: 500, pipeTemp: 500, pipePressure: 1000 });
		await hot.run(200);
		expect(hot.device(VENT).props!.read("Mode")).toBe(0);
		expect(hot.device(VENT).props!.read("On")).toBe(1);

		const cool = setup({ outsideTemp: 500, pipeTemp: 400, pipePressure: 1000 });
		await cool.run(200);
		expect(cool.device(VENT).props!.read("Mode")).toBe(0);
		expect(cool.device(VENT).props!.read("On")).toBe(0);
	});

	it("shows the pipe temperature on the housing", async () => {
		const env = setup({ outsideTemp: 300, pipeTemp: 432.5, pipePressure: 1000 });
		await env.run(200);
		expect(env.device(HOUSING).props!.read("Setting")).toBe(432.5);
	});
});
