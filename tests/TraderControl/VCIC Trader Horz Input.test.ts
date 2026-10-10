import { describe, expect, it } from "vitest";
import { describeTraderInput, press, startConsole } from "./trader-input.ts";

const SPEC = { script: "ic10/TraderControl/VCIC Trader Horz Input.ic10", prefix: "HC", other: "VC" };

describe("VCIC Trader Horz Input", () => {
	describeTraderInput(SPEC);

	it("wraps the heading around 360", async () => {
		const world = await startConsole(SPEC);
		await press(world, "Sub 1");
		expect(world.device("value")).toHaveProps({ Setting: 359 }); // mod, not %: never negative

		await press(world, "Add 5");
		expect(world.device("value")).toHaveProps({ Setting: 4 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
