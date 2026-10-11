import { describe, expect, it } from "vitest";
import { battery, sim } from "../src/index.ts";

describe("battery", () => {
	it("charges from generation, a watt a joule each tick, less its own loss", async () => {
		const world = await sim().device("bat", "StructureBattery", { On: 1 }).build();
		world.model("bat", battery({ generation: 1000 }));
		await world.runTicks(2);
		expect(world.device("bat")).toHaveProps({ Charge: 1980, Maximum: 3_600_000, Ratio: 1980 / 3_600_000, Mode: 1, PowerPotential: 1980 });
	});

	it("sums generators and supplies devices by key or path, as far as its charge allows", async () => {
		const world = await sim()
			.device("bat", "StructureBatteryLarge", { On: 1, Charge: 500 })
			.device("fuel", "StructureSolidFuelGenerator", { PowerGeneration: 300 })
			.device("wind", "StructureWindTurbine", { PowerGeneration: 200 })
			.device("lights", "StructureGrowLight", { RequiredPower: 600 })
			.device("pump", "StructureVolumePump", { RequiredPower: 1000 })
			.build();
		world.model("bat", battery({ generation: ["fuel", "wind.PowerGeneration"], usage: "lights", lossPerTick: 0 }));
		await world.runTicks(1);
		expect(world.device("bat")).toHaveProps({ Charge: 400, PowerActual: 600, Maximum: 9_000_001 });

		world.model("bat", battery({ generation: 0, usage: (w) => w.device("pump").get("RequiredPower"), lossPerTick: 0 }));
		await world.runTicks(1);
		// The first model takes 100 more; the second wants 1,000 and gets the 300 left.
		expect(world.device("bat")).toHaveProps({ Charge: 0, PowerActual: 300, Mode: 0 });
	});

	it("reports the game's charge states", async () => {
		const states: [number, number][] = [
			[1, 6],
			[0.8, 5],
			[0.5, 4],
			[0.3, 3],
			[0.1, 2],
			[0.01, 1],
		];
		for (const [ratio, mode] of states) {
			const world = await sim().device("bat", "StructureBattery", { On: 1, Charge: ratio * 3_600_000 }).build();
			world.model("bat", battery({ lossPerTick: 0 }));
			await world.runTicks(1);
			expect(world.device("bat").get("Mode"), `ratio ${ratio}`).toBe(mode);
		}
	});

	it("neither charges nor supplies while off, and stops at full", async () => {
		const world = await sim().device("bat", "StructureBattery", { On: 0, Charge: 1000 }).build();
		world.model("bat", battery({ generation: 5000, usage: 5000 }));
		await world.runTicks(1);
		expect(world.device("bat").get("Charge")).toBe(990);

		const full = await sim().device("bat", "StructureBattery", { On: 1, Charge: 3_599_999 }).build();
		full.model("bat", battery({ generation: 5000, lossPerTick: 0 }));
		await full.runTicks(1);
		expect(full.device("bat")).toHaveProps({ Charge: 3_600_000, Mode: 6 });
	});

	it("needs a capacity for a battery it doesn't know", async () => {
		const world = await sim().device("bat", "StructureBatterySmall", { On: 1 }).build();
		world.model("bat", battery({ generation: 10 }));
		await expect(world.runTicks(1)).rejects.toThrow(/battery "bat" needs a capacity/);

		const small = await sim().device("bat", "StructureBatterySmall", { On: 1 }).build();
		small.model("bat", battery({ generation: 110, capacity: 1000 }));
		await small.runTicks(1);
		expect(small.device("bat")).toHaveProps({ Charge: 100, Maximum: 1000, Ratio: 0.1, Mode: 2 });
	});
});
