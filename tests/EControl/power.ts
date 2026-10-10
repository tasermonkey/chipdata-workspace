/**
 * Tests shared by the power scripts (Power Controller Battery, Battery Control, Battery Controller 1),
 * which are built from the same pieces. Each script's test runs the pieces it has.
 */
import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const GREEN = 2;
const RED = 4;
const YELLOW = 5;

/** Console-mod parts and the nuclear battery: custom devices, by prefab and in-game name. */
const CONSOLE: [prefab: string, name: string][] = [
	["ModularDeviceLEDdisplay3", "Power Usage"],
	["ModularDeviceLEDdisplay3", "Total Power Generation"],
	["ModularDeviceLEDdisplay3", "Coal Power Generation Sum"],
	["ModularDeviceLEDdisplay3", "Coal Power Generation Avg"],
	["ModularDeviceLEDdisplay3", "Wind Turbine Generation Sum"],
	["ModularDeviceLEDdisplay3", "Wind Turbine Generation Avg"],
	["ModularDeviceLEDdisplay3", "Stored Power Display"],
	["ModularDeviceSliderDiode2", "Battery Charge Per"],
	["ModularDeviceGauge3x3", "Power Delta"],
	["ModularDeviceGauge3x3", "Battery Storage Gauge"],
	["ModularDeviceLabelDiode3", "Low Coal"],
	["ModularDeviceLightLarge", "TransformerPoweredUp Light"],
	["ModularDeviceThrottle3x2", "Transformer Throttle"],
	["ModularDeviceLEDdisplay2", "Transformer Output Value"],
];

export interface Plant {
	ratio?: number;
	charge?: number;
	/** Each coal generator's output, W. */
	coal?: number[];
	coalOn?: 0 | 1;
	/** Each wind turbine's output, W. */
	wind?: number[];
	usage?: number;
	/** Readings of other cable analyzers on the network (not "Base CA"), W. */
	otherAnalyzers?: number[];
	throttle?: number;
}

/** A power plant with every device any of the scripts uses; console parts are keyed by name. */
export function buildPlant(script: string, plant: Plant = {}) {
	const { ratio = 0.5, charge = 1000, coal = [1000], coalOn = 1, wind = [], usage = 500, otherAnalyzers = [], throttle = 0.5 } = plant;
	let builder = sim({ root: REPO_ROOT }).device("battery", "StationBatteryNuclear", { Ratio: ratio, Charge: charge }, { custom: true });
	coal.forEach((w, i) => {
		builder = builder.device(`coal${i}`, "StructureSolidFuelGenerator", { PowerGeneration: w, On: coalOn });
	});
	wind.forEach((w, i) => {
		builder = builder.device(`wind${i}`, "StructureWindTurbine", { PowerGeneration: w });
	});
	otherAnalyzers.forEach((w, i) => {
		builder = builder.device(`analyzer${i + 1}`, "StructureCableAnalysizer", { PowerRequired: w }, { name: `Other CA ${i + 1}` });
	});
	for (const [prefab, name] of CONSOLE) {
		builder = builder.device(name, prefab, name === "Transformer Throttle" ? { Setting: throttle } : {}, { custom: true, name });
	}
	return builder
		.device("analyzer", "StructureCableAnalysizer", { PowerRequired: usage }, { name: "Base CA" })
		.device("chute", "StructureChuteDigitalValveRight", {}, { name: "Coal Chute Low Marker" })
		.device("transformer", "StructureTransformer", {}, { name: "Primary Transformer" })
		.housing("ic", { file: script })
		.build();
}

const passes = (world: World, n: number) => world.runTicks(2 * n + 1); // a pass is at most 2 ticks

export function describeCoalGenerator(script: string): void {
	describe("coal generator", () => {
		it("charges the battery from 20% up to 80%, then waits for it to drain to 20% again", async () => {
			const world = await buildPlant(script, { ratio: 0.5 });
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 1 }); // left running: still charging

			world.device("battery").set("Ratio", 0.8);
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 0 });

			world.device("battery").set("Ratio", 0.5);
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 0 }); // waiting

			world.device("battery").set("Ratio", 0.2);
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 1 });

			world.device("battery").set("Ratio", 0.5);
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 1 }); // charging
			expect(world.chip("ic")).toHaveNoErrors();
		});

		// CODE_REVIEW.md 2.4: starting in the charging state, the script only ever switched the
		// generators off, so if they started off they stayed off, however low the battery got.
		it("switches the generators on when it starts with them off and the battery low", async () => {
			const world = await buildPlant(script, { ratio: 0.01, coal: [1000, 1000], coalOn: 0 });
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 1 });
			expect(world.device("coal1")).toHaveProps({ On: 1 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("keeps the generators matching its state if someone switches them by hand", async () => {
			const world = await buildPlant(script, { ratio: 0.5 });
			await passes(world, 2);
			world.device("coal0").set("On", 0); // charging, switched off
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 1 });

			world.device("battery").set("Ratio", 0.8);
			await passes(world, 2);
			world.device("battery").set("Ratio", 0.5);
			world.device("coal0").set("On", 1); // waiting, switched on
			await passes(world, 2);
			expect(world.device("coal0")).toHaveProps({ On: 0 });
		});
	});
}

export function describeLowCoalWarning(script: string): void {
	describe("low coal warning", () => {
		it("blinks the Low Coal light while the coal chute marker is empty", async () => {
			const world = await buildPlant(script);
			const light = world.record("Low Coal.On");
			await passes(world, 6);
			expect(new Set(light.values.slice(3))).toEqual(new Set([0, 1]));
			expect(world.device("Low Coal")).toHaveProps({ Color: YELLOW });
		});

		it("keeps it off while there's coal at the marker", async () => {
			const world = await buildPlant(script);
			world.device("chute").slot(0).put("ItemCoalOre", { Quantity: 20 });
			const light = world.record("Low Coal.On");
			await passes(world, 6);
			expect(light.values.every((on) => on === 0)).toBe(true);
			expect(world.chip("ic")).toHaveNoErrors();
		});
	});
}

export function describeBatteryDisplays(script: string): void {
	describe("battery displays", () => {
		const cases: [string, number, number][] = [
			["green above 75%", 0.8, GREEN],
			["yellow in between", 0.5, YELLOW],
			["red below 33%", 0.3, RED],
		];
		for (const [when, ratio, Color] of cases) {
			it(`show the charge, ${when}`, async () => {
				const world = await buildPlant(script, { ratio, charge: 12345 });
				await passes(world, 2);
				expect(world.device("Battery Charge Per")).toHaveProps({ Setting: ratio, Color });
				expect(world.device("Battery Storage Gauge")).toHaveProps({ Setting: ratio, Color });
				expect(world.device("Stored Power Display")).toHaveProps({ Setting: 12345, Color, Mode: 2 });
			});
		}
	});
}

export function describeGenerationDisplays(script: string): void {
	describe("generation and usage displays", () => {
		it("show each kind of generator's total and average, the overall total, and the usage", async () => {
			const world = await buildPlant(script, { coal: [1000, 3000], wind: [200, 400, 600], usage: 2500 });
			await passes(world, 2);

			expect(world.device("Coal Power Generation Sum")).toHaveProps({ Setting: 4000, Mode: 2 });
			expect(world.device("Coal Power Generation Avg")).toHaveProps({ Setting: 2000, Mode: 2 });
			expect(world.device("Wind Turbine Generation Sum")).toHaveProps({ Setting: 1200 });
			expect(world.device("Wind Turbine Generation Avg")).toHaveProps({ Setting: 400 });
			expect(world.device("Total Power Generation")).toHaveProps({ Setting: 5200, Mode: 2 });
			expect(world.device("Power Usage")).toHaveProps({ Setting: 2500, Mode: 2 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		// CODE_REVIEW.md 2.5: usage was the sum of every cable analyzer on the network.
		it("reads the usage from the analyzer named Base CA only", async () => {
			const world = await buildPlant(script, { coal: [1000], usage: 500, otherAnalyzers: [500, 2000] });
			await passes(world, 2);
			expect(world.device("Power Usage")).toHaveProps({ Setting: 500 });
		});
	});
}

export function describePowerDelta(script: string): void {
	describe("power delta gauge", () => {
		it("shows generation / (generation + usage): green while under half is used", async () => {
			const world = await buildPlant(script, { coal: [1000], usage: 500 });
			await passes(world, 2);
			expect(world.device("Power Delta")).toHaveProps({ Setting: expect.closeTo(1000 / 1500, 5), Color: GREEN });
		});

		it("red once more than half is used", async () => {
			const world = await buildPlant(script, { coal: [1000], usage: 3000 });
			await passes(world, 2);
			expect(world.device("Power Delta")).toHaveProps({ Setting: 0.25, Color: RED });
		});

		// CODE_REVIEW.md 1.9 (Battery Controller 1): the guard tested the battery ratio.
		it("still updates when the battery is empty", async () => {
			const world = await buildPlant(script, { ratio: 0, coal: [1000], usage: 500 });
			await passes(world, 2);
			expect(world.device("Power Delta")).toHaveProps({ Setting: expect.closeTo(1000 / 1500, 5) });
		});

		it("shows 0, not NaN, with no generation and no usage", async () => {
			const world = await buildPlant(script, { coal: [0], usage: 0 });
			await passes(world, 2);
			expect(world.device("Power Delta")).toHaveProps({ Setting: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		});
	});
}

export function describeTransformer(script: string): void {
	describe("transformer", () => {
		it("sets the transformer to the throttle × 50,000 W, and shows it", async () => {
			const world = await buildPlant(script, { throttle: 0.4, usage: 5000 });
			await passes(world, 2);
			expect(world.device("transformer")).toHaveProps({ Setting: 20000 });
			expect(world.device("Transformer Output Value")).toHaveProps({ Setting: 20000, Mode: 2 });
		});

		it("blinks its light while the base needs more than the transformer gives", async () => {
			const world = await buildPlant(script, { throttle: 0.1, usage: 8000 }); // 5,000 W < 8,000 W
			const light = world.record("TransformerPoweredUp Light.On");
			await passes(world, 6);
			expect(new Set(light.values.slice(3))).toEqual(new Set([0, 1]));
			expect(world.device("TransformerPoweredUp Light")).toHaveProps({ Color: YELLOW });
		});

		it("keeps the light off while it gives enough", async () => {
			const world = await buildPlant(script, { throttle: 0.5, usage: 8000 });
			const light = world.record("TransformerPoweredUp Light.On");
			await passes(world, 6);
			expect(light.values.every((on) => on === 0)).toBe(true);
			expect(world.chip("ic")).toHaveNoErrors();
		});
	});
}
