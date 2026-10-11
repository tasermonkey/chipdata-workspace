import { describe, expect, it } from "vitest";
import { activeVent, GRID_VOLUME, heatExchange, IDEAL_GAS_CONSTANT, poweredVent, sim } from "../src/index.ts";

const OUTSIDE = { temperature: 150, pressure: 30, ratios: { Nitrogen: 1 } };

function ventWorld(pipeKPa: number, ventProps: Record<string, number> = {}, prefab: "StructureActiveVent" | "StructurePoweredVent" = "StructureActiveVent") {
	return sim()
		.room("outside", OUTSIDE)
		.pipe("coolant", { volume: 100, temperature: 150, pressure: pipeKPa, ratios: { Nitrogen: 1 } })
		.device("vent", prefab, ventProps, { ports: { output: "coolant" }, room: "outside" })
		.build();
}

describe("activeVent", () => {
	it("Inward (Mode 1) fills the pipe from the room, a cell's worth of pressurePerTick at a time", async () => {
		const world = await ventWorld(0, { Mode: 1, On: 1 });
		world.model("vent", activeVent({ pressurePerTick: 10 }));
		await world.runTicks(1);
		const perTick = (10 * GRID_VOLUME) / (IDEAL_GAS_CONSTANT * 150);
		expect(world.pipe("coolant").totalMoles).toBeCloseTo(perTick, 9);
		expect(world.device("vent")).toHaveProps({ PressureExternal: 0, PressureInternal: 50662.5 });
	});

	it("Inward stops at the pipe-side limit, PressureInternal", async () => {
		const world = await ventWorld(0, { Mode: 1, On: 1, PressureExternal: 0, PressureInternal: 200 });
		world.model("vent", activeVent());
		await world.runTicks(20);
		expect(world.pipe("coolant").pressure).toBeCloseTo(200, 6);
	});

	it("Outward (Mode 0) empties the pipe into outside air", async () => {
		const world = await ventWorld(500, { Mode: 0, On: 1 });
		world.model("vent", activeVent());
		const pressure = world.record("coolant.Pressure");
		await world.runTicks(10);
		expect(pressure.values[1]).toBeLessThan(500);
		expect(world.pipe("coolant").pressure).toBe(0);
		expect(world.device("vent")).toHaveProps({ PressureExternal: 101.325, PressureInternal: 0, PressureOutput: 0 });
	});

	it("Outward stops when a sealed room reaches PressureExternal", async () => {
		const world = await sim()
			.room("hall", { volume: GRID_VOLUME, temperature: 300 })
			.pipe("supply", { volume: 1000, temperature: 300, pressure: 5000, ratios: { Nitrogen: 1 } })
			.device("vent", "StructureActiveVent", { Mode: 0, On: 1, PressureExternal: 50 }, { ports: { output: "supply" }, room: "hall" })
			.build();
		world.model("vent", activeVent());
		await world.runTicks(20);
		expect(world.room("hall").pressure).toBeCloseTo(50, 6);
	});

	it("does nothing while off", async () => {
		const world = await ventWorld(500, { Mode: 0, On: 0 });
		world.model("vent", activeVent());
		await world.runTicks(5);
		expect(world.pipe("coolant").pressure).toBeCloseTo(500, 9);
	});

	it("resets its limits when a script changes Mode, keeping a limit set in the same tick", async () => {
		const world = await sim()
			.room("outside", OUTSIDE)
			.pipe("coolant", { volume: 100, temperature: 150 })
			.device("vent", "StructureActiveVent", {}, { ports: { output: "coolant" }, room: "outside" })
			// Tick 0: Inward. Tick 2: Outward, with its own external limit.
			.housing("ic", {
				code: "s d0 Mode 1\nyield\nyield\ns d0 Mode 0\ns d0 PressureExternal 70\nyield\nj 5",
				pins: { d0: "vent" },
			})
			.build();
		world.model("vent", activeVent());
		await world.runTicks(2); // the model saw Inward in tick 1
		expect(world.device("vent")).toHaveProps({ Mode: 1, PressureExternal: 0, PressureInternal: 50662.5 });
		await world.runTicks(2); // and Outward in tick 3
		expect(world.device("vent")).toHaveProps({ Mode: 0, PressureExternal: 70, PressureInternal: 0 });
	});

	it("needs its pipe and room", async () => {
		const world = await sim().device("vent", "StructureActiveVent", { On: 1 }).build();
		world.model("vent", activeVent());
		await expect(world.runTicks(1)).rejects.toThrow(/active vent "vent" needs a pipe and a room/);
	});
});

describe("poweredVent", () => {
	it("has no pipe-side limit: Inward keeps filling", async () => {
		const world = await ventWorld(0, { Mode: 1, On: 1 }, "StructurePoweredVent");
		world.model("vent", poweredVent({ pressurePerTick: 50 }));
		await world.runTicks(4);
		const perTick = (30 * GRID_VOLUME) / (IDEAL_GAS_CONSTANT * 150); // the outside's 30 kPa, under 50
		expect(world.pipe("coolant").totalMoles).toBeCloseTo(4 * perTick, 6);
	});
});

describe("heatExchange", () => {
	it("cools a hot pipe toward a cold one each tick", async () => {
		const world = await sim()
			.pipe("hot", { volume: 100, temperature: 400, gases: { CarbonDioxide: 2 } })
			.pipe("cold", { volume: 100, temperature: 150, gases: { Nitrogen: 2 } })
			.build();
		world.model(heatExchange("hot", "cold", { fraction: 0.5 }));
		await world.runTicks(1);
		const settled = (28.2 * 400 + 20.6 * 150) / (28.2 + 20.6);
		expect(world.pipe("hot").temperature).toBeCloseTo((400 + settled) / 2, 9);
	});

	it("gives the same cooling over time at a different tick length", async () => {
		const run = async (tickSeconds: number, ticks: number) => {
			const world = await sim({ tickSeconds })
				.pipe("hot", { volume: 100, temperature: 400, gases: { CarbonDioxide: 2 } })
				.room("outside", OUTSIDE)
				.build();
			world.model(heatExchange("hot", "outside", { fraction: 0.2 }));
			await world.runTicks(ticks);
			return world.pipe("hot").temperature;
		};
		expect(await run(0.25, 8)).toBeCloseTo(await run(0.5, 4), 9);
	});
});
