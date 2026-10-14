import { describe, expect, it } from "vitest";
import { describeTraderInput, pressButton, startConsole, typeValue } from "./trader-input.ts";

const SPEC = { script: "ic10/TraderControl/VCIC Trader Horz Input.ic10", prefix: "HC", other: "VC" };

describe("VCIC Trader Horz Input", () => {
	describeTraderInput(SPEC);

	it("wraps the heading around 360", async () => {
		const world = await startConsole(SPEC);
		await pressButton(world, "Sub 1");
		expect(world.device("value")).toHaveProps({ Setting: 359 }); // mod, not %: never negative

		await pressButton(world, "Add 5");
		expect(world.device("value")).toHaveProps({ Setting: 4 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("wraps a typed heading of 360 or more too", async () => {
		const world = await startConsole(SPEC);
		await typeValue(world, 400);
		expect(world.device("value")).toHaveProps({ Setting: 40 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
