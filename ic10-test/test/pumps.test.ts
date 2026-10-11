import { describe, expect, it } from "vitest";
import { backPressureRegulator, pressureRegulator, sim, volumePump } from "../src/index.ts";

const N2 = { Nitrogen: 1 };

type PumpPrefab = "StructureVolumePump" | "StructurePressureRegulator" | "StructureBackPressureRegulator";

function pumpWorld(prefab: PumpPrefab, props: Record<string, number>, inputKPa: number, outputKPa: number, outputVolume = 100) {
	return sim()
		.pipe("in", { volume: 100, temperature: 300, pressure: inputKPa, ratios: N2 })
		.pipe("out", { volume: outputVolume, temperature: 300, pressure: outputKPa, ratios: N2 })
		.device("pump", prefab, props, { ports: { input: "in", output: "out" } })
		.build();
}

describe("volumePump", () => {
	it("moves Setting litres of the input's gas each tick", async () => {
		const world = await pumpWorld("StructureVolumePump", { On: 1, Setting: 10 }, 1000, 0);
		world.model("pump", volumePump());
		const before = world.pipe("in").totalMoles;
		await world.runTicks(1);
		expect(world.pipe("in").totalMoles).toBeCloseTo(before * 0.9, 9);
		expect(world.pipe("out").totalMoles).toBeCloseTo(before * 0.1, 9);
	});

	it("pumps against pressure, and caps Setting at maxSetting", async () => {
		const world = await pumpWorld("StructureVolumePump", { On: 1, Setting: 50 }, 100, 5000);
		world.model("pump", volumePump());
		await world.runTicks(1);
		expect(world.pipe("in").pressure).toBeCloseTo(90, 9);
	});

	it("does nothing while off", async () => {
		const world = await pumpWorld("StructureVolumePump", { On: 0, Setting: 10 }, 1000, 0);
		world.model("pump", volumePump());
		await world.runTicks(3);
		expect(world.pipe("out").totalMoles).toBe(0);
	});

	it("needs both pipes", async () => {
		const world = await sim().device("pump", "StructureVolumePump", { On: 1 }).build();
		world.model("pump", volumePump());
		await expect(world.runTicks(1)).rejects.toThrow(/volume pump "pump" needs pipes on input, output/);
	});
});

describe("pressureRegulator", () => {
	it("fills the output up to Setting, at least a quarter of the way to even each tick", async () => {
		const world = await pumpWorld("StructurePressureRegulator", { On: 1, Setting: 1000 }, 5000, 0);
		world.model("pump", pressureRegulator());
		await world.runTicks(1);
		// Even would be 2,500 kPa each; a quarter of the way is 625.
		expect(world.pipe("out").pressure).toBeCloseTo(625, 6);
		await world.runTicks(5);
		expect(world.pipe("out").pressure).toBeCloseTo(1000, 6);
	});

	it("pumps uphill at pressurePerTick through a pipe segment", async () => {
		const world = await pumpWorld("StructurePressureRegulator", { On: 1, Setting: 1000 }, 100, 500);
		world.model("pump", pressureRegulator());
		await world.runTicks(1);
		// 101.325 kPa of 10 L lands in 100 L: a tenth of that.
		expect(world.pipe("out").pressure).toBeCloseTo(510.1325, 6);
	});

	it("leaves an output at or above Setting alone", async () => {
		const world = await pumpWorld("StructurePressureRegulator", { On: 1, Setting: 300 }, 5000, 400);
		world.model("pump", pressureRegulator());
		await world.runTicks(3);
		expect(world.pipe("out").pressure).toBeCloseTo(400, 9);
	});
});

describe("backPressureRegulator", () => {
	it("lets gas through while the input is above Setting, down to Setting", async () => {
		const world = await pumpWorld("StructureBackPressureRegulator", { On: 1, Setting: 1500 }, 2000, 0, 1000);
		world.model("pump", backPressureRegulator());
		await world.runTicks(10);
		expect(world.pipe("in").pressure).toBeCloseTo(1500, 6);
		await world.runTicks(5);
		expect(world.pipe("in").pressure).toBeCloseTo(1500, 6);
	});
});
