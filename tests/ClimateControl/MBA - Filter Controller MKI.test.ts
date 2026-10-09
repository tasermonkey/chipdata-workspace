import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const GOOD = { TemperatureInput: 298, PressureInput: 6000, PressureOutput: 1000 };

/** The chip sits in the filtration unit itself (db). */
function build(props: Partial<typeof GOOD>) {
	return sim({ root: REPO_ROOT })
		.housing("filter", {
			file: "ic10/ClimateControl/MBA - Filter Controller MKI.ic10",
			prefab: "StructureFiltration",
			props: { ...GOOD, ...props },
		})
		.build();
}

describe("MBA - Filter Controller MKI", () => {
	it("filters while the waste gas is 23–27 °C, above 5,000 kPa, and the output isn't full", async () => {
		const world = await build({});
		await world.runTicks(1);
		expect(world.db("filter")).toHaveProps({ Mode: 1 });
		expect(world.chip("filter")).toHaveNoErrors();
	});

	const stops: [string, Partial<typeof GOOD>][] = [
		["the waste gas is too hot", { TemperatureInput: 300 }],
		["the waste gas is too cold", { TemperatureInput: 296 }],
		["the input pressure is low", { PressureInput: 5000 }],
		["the output is full", { PressureOutput: 40000 }],
	];
	for (const [when, props] of stops) {
		it(`stops filtering when ${when}`, async () => {
			const world = await build({});
			await world.runTicks(1);
			for (const [prop, value] of Object.entries(props)) world.db("filter").set(prop, value);
			await world.runSeconds(6); // it checks every 5 s
			expect(world.db("filter")).toHaveProps({ Mode: 0 });
		});
	}
});
