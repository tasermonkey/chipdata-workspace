import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/SuitControl/Simple SUit Controller MKII.ic10";

/** The chip sits in the suit (db); the helmet is on d0 and closed, in vacuum. */
function build(helmet: { pressure: number; ratioOxygen: number }) {
	return sim({ root: REPO_ROOT })
		.device("helmet", "ItemHardsuitHelmet", {
			Open: 0,
			Pressure: helmet.pressure,
			RatioOxygen: helmet.ratioOxygen,
			Temperature: 293,
		})
		.housing("suit", {
			file: SCRIPT,
			prefab: "ItemHardSuit",
			pins: { d0: "helmet" },
			props: { PressureExternal: 0, PressureSetting: 100, TemperatureSetting: 293 },
		})
		.build();
}

// CODE_REVIEW.md 1.6: filtration came on for low O2 but went off on total pressure, so it chattered.
describe("Simple Suit Controller MKII filtration", () => {
	it("stays on while O2 is low, even though the helmet pressure is normal", async () => {
		const world = await build({ pressure: 100, ratioOxygen: 0.2 }); // 20 kPa of O2
		const filtration = world.record("suit.Filtration");
		await world.runTicks(20);

		expect(filtration).toToggleAtMost(1); // off → on
		expect(world.db("suit")).toHaveProps({ Filtration: 1, AirRelease: 1 });
		expect(world.chip("suit")).toHaveNoErrors();
	});

	it("goes off again once O2 has recovered", async () => {
		const world = await build({ pressure: 100, ratioOxygen: 0.2 });
		await world.runTicks(5);

		world.device("helmet").set("RatioOxygen", 0.5); // 50 kPa
		await world.runTicks(5);

		expect(world.db("suit")).toHaveProps({ Filtration: 0 });
	});

	it("leaves filtration off while O2 is fine", async () => {
		const world = await build({ pressure: 100, ratioOxygen: 0.5 });
		const filtration = world.record("suit.Filtration");
		await world.runTicks(20);

		expect(filtration).toToggleAtMost(0);
		expect(world.chip("suit")).toHaveNoErrors();
	});
});
