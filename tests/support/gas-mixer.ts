/**
 * Tests shared by the gas mixer scripts (the N-CO2 and O2-CO2-N air mixers and the fuel mixer),
 * which are copies of one workshop script with different devices and ratios.
 */
import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";
import { readRepoScript, REPO_ROOT } from "./paths.ts";

/** The copy every mixer's shared code is compared with. */
const REFERENCE = "ic10/ClimateControl/AirMixers/MBA - O2-CO2-N Mixer [50597].ic10";

/** A mixer's code after its settings: the part every copy shares. */
const shared = (path: string) => readRepoScript(path).split("# The mixer copies are the same from here on")[1];

export interface MixerSpec {
	script: string;
	mixer: string;
	/**
	 * Names of the pipe analyzers on Gas Input 1 (the mixer's back input), Gas Input 2 and the
	 * output. Tanks no longer have logic in game, so the scripts read analyzers on their networks.
	 */
	input1: string;
	input2: string;
	output: string;
	/** Fraction of Gas Input 1. */
	ratio: number;
	/** The script's MinPressure: inputs at or below it don't count. */
	minPressure: number;
	/** The script's MinMoles: inputs holding this many moles or fewer don't count. */
	minMoles: number;
}

const OUTPUT_LIMIT = 40000; // kPa, the same in every copy

interface Gas {
	pressure: number;
	temperature: number;
	moles?: number;
}

function build(spec: MixerSpec, gases: { input1?: Gas; input2?: Gas; output: Gas }) {
	const analyzers = (["input1", "input2", "output"] as const).flatMap((port) => {
		const gas = gases[port];
		if (!gas) return []; // not built
		const props = { On: 1, Pressure: gas.pressure, TotalMoles: gas.moles ?? 100, Temperature: gas.temperature };
		return [[port, "StructurePipeAnalysizer", props, { name: spec[port] }] as const];
	});
	return sim({ root: REPO_ROOT })
		.device("mixer", "StructureGasMixer", {}, { name: spec.mixer })
		.devices(analyzers)
		.housing("ic", { file: spec.script })
		.build();
}

/** The mixer's Setting for a ratio X of input 1: 100 · T1·X / (T1·X + T2·(1 − X)). */
function setting(ratio: number, t1: number, t2: number): number {
	return (100 * t1 * ratio) / (t1 * ratio + t2 * (1 - ratio));
}

export function describeGasMixer(spec: MixerSpec): void {
	const full = spec.minPressure + 5000;
	const input1 = { pressure: full, temperature: 300 };
	const input2 = { pressure: full, temperature: 200 };
	const output = { pressure: 1000, temperature: 290 };

	describe("gas mixer", () => {
		it("is the same code as the other mixers, apart from its settings", () => {
			expect(shared(spec.script)).toBeDefined();
			expect(shared(spec.script)).toEqual(shared(REFERENCE));
		});

		it("mixes at the ratio, corrected for the inputs' temperatures", async () => {
			const world = await build(spec, { input1, input2, output });
			await world.runTicks(3);

			expect(world.device("mixer")).toHaveProps({
				On: 1,
				Setting: expect.closeTo(setting(spec.ratio, 300, 200), 3),
			});
			expect(world.db("ic")).toHaveProps({ Setting: 1 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("stops when the output reaches 40,000 kPa", async () => {
			const world = await build(spec, { input1, input2, output });
			await world.runTicks(3);
			world.device("output").set("Pressure", OUTPUT_LIMIT + 1);
			await world.runTicks(2);

			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(world.db("ic")).toHaveProps({ Setting: 0 });
		});

		it("stops when an input runs low", async () => {
			const world = await build(spec, { input1, input2, output });
			await world.runTicks(3);
			world.device("input2").set("Pressure", spec.minPressure);
			await world.runTicks(2);

			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(world.db("ic")).toHaveProps({ Setting: 0 });
		});

		it(`counts an input holding more than ${spec.minMoles} mol, and not one holding ${spec.minMoles}`, async () => {
			const world = await build(spec, { input1, input2: { ...input2, moles: spec.minMoles + 1 }, output });
			await world.runTicks(3);
			expect(world.device("mixer")).toHaveProps({ On: 1 });

			world.device("input2").set("TotalMoles", spec.minMoles);
			await world.runTicks(2);
			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		// The housing once showed the mixer's On, so a missing device looked like "off".
		it("shows NaN on the housing when the inputs are missing", async () => {
			const world = await build(spec, { output });
			await world.runTicks(3);

			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(world.db("ic").get("Setting")).toBeNaN();
		});
	});
}
