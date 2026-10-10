import { describe, expect, it } from "vitest";
import { describeTraderInput, press, startConsole } from "./trader-input.ts";

const SPEC = { script: "ic10/TraderControl/VCIC Trader Vert Input.ic10", prefix: "VC", other: "HC" };

describe("VCIC Trader Vert Input", () => {
	// CODE_REVIEW.md 1.10: copied from the Horz script, it zeroed the horizontal display on startup.
	describeTraderInput(SPEC);

	it("keeps the tilt between 0 and 90", async () => {
		const world = await startConsole(SPEC);
		await press(world, "Sub 1");
		expect(world.device("value")).toHaveProps({ Setting: 0 });

		for (let i = 0; i < 10; i++) await press(world, "Add 10");
		expect(world.device("value")).toHaveProps({ Setting: 90 });
	});
});
