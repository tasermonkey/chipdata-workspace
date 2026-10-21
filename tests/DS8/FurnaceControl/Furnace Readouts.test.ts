import { describe, expect, it } from "vitest";
import { LedMode } from "@tasermonkey/ic10-bench";
import { build, type Consoles, defines, type RackSetup, type Readout } from "./rack.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Readouts.ic10";
const { FURNACE_K_MAX, FURNACE_KPA_MAX, BOX_K_MAX, BOX_KPA_MAX } = defines(SCRIPT);

const fit = (setup: RackSetup = {}) =>
	build({
		...setup,
		chips: ["readouts"],
		props: { furnace: { Temperature: 1234, Pressure: 23500 }, sensor: { Temperature: 296, Pressure: 101.5 } },
	});

const GAUGES = ["ModularDeviceGauge2x2", "ModularDeviceGauge3x3", "ModularDeviceEdgewiseMeter3"] as const satisfies readonly Readout[];

describe("Furnace Readouts (DS-8)", () => {
	for (const consoles of ["vanilla", "modular"] as const satisfies readonly Consoles[]) {
		it(`shows temperatures in kelvin and pressures in pascals on ${consoles} displays`, async () => {
			const world = await fit({ consoles });
			await world.runTicks(2);
			expect(world.device("furnaceK")).toHaveProps({ On: 1, Mode: LedMode.Kelvin, Setting: 1234 });
			expect(world.device("furnaceKpa")).toHaveProps({ On: 1, Mode: LedMode.Pa, Setting: 23500 * 1000 });
			expect(world.device("boxK")).toHaveProps({ On: 1, Mode: LedMode.Kelvin, Setting: 296 });
			expect(world.device("boxKpa")).toHaveProps({ On: 1, Mode: LedMode.Pa, Setting: 101.5 * 1000 });
			expect(world.chip("readouts")).toHaveNoErrors();
		});
	}

	for (const gauge of GAUGES) {
		it(`shows kelvin and kPa on a ${gauge}, against its scale`, async () => {
			const world = await fit({ readouts: gauge });
			await world.runTicks(2);
			expect(world.device("furnaceK")).toHaveProps({ On: 1, Minimum: 0, Maximum: FURNACE_K_MAX, Setting: 1234 });
			expect(world.device("furnaceKpa")).toHaveProps({ On: 1, Minimum: 0, Maximum: FURNACE_KPA_MAX, Setting: 23500 });
			expect(world.device("boxK")).toHaveProps({ Minimum: 0, Maximum: BOX_K_MAX, Setting: 296 });
			expect(world.device("boxKpa")).toHaveProps({ Minimum: 0, Maximum: BOX_KPA_MAX, Setting: 101.5 });
			expect(world.chip("readouts")).toHaveNoErrors();
		});
	}

	it("takes displays and gauges mixed", async () => {
		const world = await fit({ readouts: ["display", "ModularDeviceGauge3x3", "ModularDeviceEdgewiseMeter3", "display"] });
		await world.runTicks(2);
		expect(world.device("furnaceK")).toHaveProps({ Mode: LedMode.Kelvin, Setting: 1234 });
		expect(world.device("furnaceKpa")).toHaveProps({ Maximum: FURNACE_KPA_MAX, Setting: 23500 });
		expect(world.device("boxK")).toHaveProps({ Maximum: BOX_K_MAX, Setting: 296 });
		expect(world.device("boxKpa")).toHaveProps({ Mode: LedMode.Pa, Setting: 101500 });
		expect(world.chip("readouts")).toHaveNoErrors();
	});

	it("waits, without errors, until its devices are on their ports", async () => {
		const world = await fit({ without: ["sensor"] });
		await world.runTicks(5);
		expect(world.chip("readouts")).toHaveNoErrors();
		expect(world.chip("readouts")).toNeverAutoYield();
	});
});
