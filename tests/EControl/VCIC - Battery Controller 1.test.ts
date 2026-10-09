import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/EControl/VCIC - Battery Controller 1.ic10";

/** A nuclear battery, a coal generator and a cable analyzer, with the "Power Delta" gauge to watch. */
function build({ ratio, generation, usage }: { ratio: number; generation: number; usage: number }) {
	return sim({ root: REPO_ROOT })
		.device("battery", "StationBatteryNuclear", { Ratio: ratio, Charge: ratio * 1000 }, { custom: true })
		.device("generator", "StructureSolidFuelGenerator", { PowerGeneration: generation })
		.device("analyzer", "StructureCableAnalysizer", { PowerRequired: usage }, { name: "Base CA" })
		.device("delta", "ModularDeviceGauge3x3", {}, { custom: true, name: "Power Delta" })
		.housing("ic", { file: SCRIPT })
		.build();
}

describe("VCIC - Battery Controller 1", () => {
	it("shows the share of generation in use on the Power Delta gauge", async () => {
		const world = await build({ ratio: 0.5, generation: 1000, usage: 500 });
		await world.runTicks(3);

		expect(world.device("delta")).toHaveProps({ Setting: expect.closeTo(1 / 1.5, 5), Color: 2 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 1.9: the divide-by-zero guard tested r0, the battery ratio, not the generation.
	it("still updates the gauge when the battery is empty", async () => {
		const world = await build({ ratio: 0, generation: 1000, usage: 500 });
		await world.runTicks(3);

		expect(world.device("delta")).toHaveProps({ Setting: expect.closeTo(1 / 1.5, 5) });
	});

	it("shows 0, not NaN, with no generation and no usage", async () => {
		const world = await build({ ratio: 0.5, generation: 0, usage: 0 });
		await world.runTicks(3);

		expect(world.device("delta")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
