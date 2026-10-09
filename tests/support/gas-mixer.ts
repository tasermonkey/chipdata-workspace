/**
 * Tests shared by the gas mixer scripts (the N-CO2 and O2-CO2-N air mixers and the fuel mixer),
 * which are copies of one workshop script with different devices and ratios.
 */
import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "./paths.ts";

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
}

const OUTPUT_LIMIT = 40000; // kPa, the same in every copy

interface Gas {
	pressure: number;
	temperature: number;
}

function build(spec: MixerSpec, gases: { input1?: Gas; input2?: Gas; output: Gas }) {
	let builder = sim({ root: REPO_ROOT }).device("mixer", "StructureGasMixer", {}, { name: spec.mixer });
	for (const port of ["input1", "input2", "output"] as const) {
		const gas = gases[port];
		if (!gas) continue; // not built
		const props = { On: 1, Pressure: gas.pressure, TotalMoles: 100, Temperature: gas.temperature };
		builder = builder.device(port, "StructurePipeAnalysizer", props, { name: spec[port] });
	}
	return builder.housing("ic", { file: spec.script }).build();
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

		// CODE_REVIEW.md 1.11: the housing showed the mixer's On, so a missing device looked like "off".
		it("shows NaN on the housing when the inputs are missing", async () => {
			const world = await build(spec, { output });
			await world.runTicks(3);

			expect(world.device("mixer")).toHaveProps({ On: 0 });
			expect(world.db("ic").get("Setting")).toBeNaN();
		});
	});
}
