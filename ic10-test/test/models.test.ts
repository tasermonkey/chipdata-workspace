import { describe, expect, it } from "vitest";
import { exchangeHeat, sim } from "../src/index.ts";

// Opens the lever in the first tick, then reads the pipe analyzer each tick.
const CHIP = "s d1 Open 1\nloop:\nl r0 d0 Temperature\nyield\nj loop";

function build() {
	return sim()
		.pipe("hot", { volume: 100, temperature: 400, gases: { CarbonDioxide: 5 } })
		.pipe("cold", { volume: 100, temperature: 200, gases: { Nitrogen: 5 } })
		.device("pa", "StructurePipeAnalysizer", {}, { pipe: "hot" })
		.device("switch", "StructureLogicSwitch")
		.housing("ic", { code: CHIP, pins: { d0: "pa", d1: "switch" } })
		.build();
}

describe("models", () => {
	it("run every tick with the device, the tick's length and the world", async () => {
		const world = await build();
		const calls: [string, number, number][] = [];
		world.model("switch", (device, dt, w) => calls.push([device.key, dt, w.tick]));
		await world.runTicks(3);
		expect(calls).toEqual([
			["switch", 0.5, 0],
			["switch", 0.5, 1],
			["switch", 0.5, 2],
		]);
	});

	it("see what a chip set in the tick before, and change the world before chips read it", async () => {
		const world = await build();
		const seen: number[] = [];
		world.model("switch", (device, _dt, w) => {
			seen.push(device.get("Open"));
			if (device.get("Open") === 1) w.pipe("hot").setTemperature(w.pipe("hot").temperature - 10);
		});
		await world.runTicks(3);
		expect(seen).toEqual([0, 1, 1]); // the chip's write in tick 0 acts from tick 1
		expect(world.pipe("hot").temperature).toBe(380);
		expect(world.chip("ic")).toHaveRegister("r0", 380); // read in tick 2, after the model ran
	});

	it("can be world-wide, and run in the order added, after scripted events", async () => {
		const world = await build();
		const order: string[] = [];
		world.at({ tick: 0 }, () => order.push("event"));
		world.model(() => order.push("first"));
		world.model("pa", () => order.push("second"));
		await world.runTicks(1);
		expect(order).toEqual(["event", "first", "second"]);
	});

	it("move heat between pipes, closing the loop through a chip's readings", async () => {
		const world = await build();
		world.model((_dt, w) => exchangeHeat(w.pipe("hot"), w.pipe("cold"), 0.2));
		const temperature = world.record("ic.r0");
		await world.runTicks(40);
		const values = temperature.values.slice(2);
		for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]!);
		const settled = (5 * 28.2 * 400 + 5 * 20.6 * 200) / (5 * 28.2 + 5 * 20.6);
		expect(world.pipe("hot").temperature).toBeCloseTo(settled, 0);
	});

	it("can be cancelled", async () => {
		const world = await build();
		let runs = 0;
		const cancel = world.model(() => runs++);
		await world.runTicks(2);
		cancel();
		await world.runTicks(2);
		expect(runs).toBe(2);
	});

	it("keep runUntil going once chips stop, and name the model when one throws", async () => {
		const world = await sim()
			.pipe("p", { volume: 100, temperature: 300 })
			.housing("ic", { code: "move r0 1" })
			.build();
		world.model((_dt, w) => w.pipe("p").setTemperature(w.pipe("p").temperature - 1));
		await world.runUntil((w) => w.pipe("p").temperature <= 295, { maxTicks: 10 });

		world.model("ic", () => {
			throw new Error("boom");
		});
		await expect(world.runTicks(1)).rejects.toThrow(/model for "ic" failed in tick \d+: boom/);
	});
});
