// Several chips as threads, and an inline program's source: see chips.ic10.
import { sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

/** Puts 5, 6, 7, ... on the control chip's stack, one a tick. */
const SETUP = ["alias Next r0", "move Next 5", "loop:", "put d0 0 Next", "add Next Next 1", "yield", "j loop"].join("\n");

describe("chips", () => {
	it("adds up what the setup chip sends", async () => {
		const world = await sim({ root: import.meta.dirname })
			.housing("setup", { code: SETUP, pins: { d0: "control" } })
			.housing("control", { file: "chips.ic10" })
			.build();
		await world.runTicks(3);
		expect(world.chip("control")).toHaveRegister("Total", 5 + 6 + 7);
		expect(world.chip("control")).toHaveProps({ Setting: 18 });
	});
});
