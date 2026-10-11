import { describe, expect, it } from "vitest";
import { filtration, IDEAL_GAS_CONSTANT, PIPE_VOLUME, sim } from "../src/index.ts";

async function filterWorld(props: Record<string, number>, ratios: Record<string, number>) {
	const world = await sim()
		.pipe("in", { volume: 100, temperature: 300, pressure: 1000, ratios })
		.pipe("out", { volume: 100, temperature: 300 })
		.pipe("waste", { volume: 100, temperature: 300 })
		.device("filter", "StructureFiltration", props, { ports: { input: "in", output: "out", output2: "waste" } })
		.build();
	return world;
}

describe("filtration", () => {
	it("sends its filters' gas to output and the rest to waste (output2)", async () => {
		const world = await filterWorld({ On: 1, Mode: 1 }, { Nitrogen: 1, CarbonDioxide: 1 });
		world.device("filter").slot(0).put("ItemGasFilterCarbonDioxideL");
		world.model("filter", filtration());
		await world.runTicks(1);
		// 1,000 kPa above both outputs: 101.325 kPa plus a third of the way to 20,265, of 10 L.
		const kPa = 101.325 + (1000 * (60795 / 3 - 101.325)) / 60795;
		const drawn = (kPa * PIPE_VOLUME) / (IDEAL_GAS_CONSTANT * 300);
		expect(world.pipe("out").moles("CarbonDioxide")).toBeCloseTo(drawn / 2, 9);
		expect(world.pipe("out").moles("Nitrogen")).toBe(0);
		expect(world.pipe("waste").moles("Nitrogen")).toBeCloseTo(drawn / 2, 9);
		expect(world.device("filter")).toHaveProps({ RatioCarbonDioxideOutput: 1, RatioNitrogenOutput2: 1 });
	});

	it("does nothing in Mode 0 or while off", async () => {
		for (const props of [{ On: 1, Mode: 0 }, { On: 0, Mode: 1 }]) {
			const world = await filterWorld(props, { Nitrogen: 1, CarbonDioxide: 1 });
			world.model("filter", filtration({ gases: ["CarbonDioxide"] }));
			await world.runTicks(2);
			expect(world.pipe("in").pressure).toBeCloseTo(1000, 9);
		}
	});

	it("ignores empty filters, and passes everything to waste without one", async () => {
		const world = await filterWorld({ On: 1, Mode: 1 }, { Nitrogen: 1, CarbonDioxide: 1 });
		world.device("filter").slot(1).put("ItemGasFilterCarbonDioxide", { Quantity: 0 });
		world.model("filter", filtration());
		await world.runTicks(1);
		expect(world.pipe("out").totalMoles).toBe(0);
		expect(world.pipe("waste").ratio("CarbonDioxide")).toBeCloseTo(0.5, 9);
	});

	it("takes a filtered gas's liquid form, and the last trace of it from the input", async () => {
		const world = await sim()
			.pipe("in", { volume: 100, temperature: 300, gases: { Nitrogen: 40, Oxygen: 0.01, LiquidOxygen: 1 } })
			.pipe("out", { volume: 100, temperature: 300 })
			.pipe("waste", { volume: 100, temperature: 300 })
			.device("filter", "StructureFiltration", { On: 1, Mode: 1 }, { ports: { input: "in", output: "out", output2: "waste" } })
			.build();
		world.model("filter", filtration({ gases: ["Oxygen"] }));
		await world.runTicks(1);
		expect(world.pipe("in").moles("Oxygen")).toBe(0);
		expect(world.pipe("out").moles("Oxygen")).toBeCloseTo(0.01, 12);
		expect(world.pipe("out").moles("LiquidOxygen")).toBeGreaterThan(0);
		expect(world.pipe("waste").moles("LiquidOxygen")).toBe(0);
	});

	it("needs all three pipes, and knows its gases", async () => {
		expect(() => filtration({ gases: ["Oxygn" as "Oxygen"] })).toThrow('filtration: no gas "Oxygn"');
		const world = await sim().device("filter", "StructureFiltration", { On: 1, Mode: 1 }).build();
		world.model("filter", filtration());
		await expect(world.runTicks(1)).rejects.toThrow(/filtration unit "filter" needs pipes on input, output, output2/);
	});
});
