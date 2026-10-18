import { describe, expect, it } from "vitest";
import { readRepoScript } from "../support/paths.ts";
import { describeTraderInput, pressButton, startConsole, typeValue } from "./trader-input.ts";

const SPEC = { script: "ic10/TraderControl/Trader Vert Input.ic10", prefix: "VC", other: "HC" };
const HORZ = "ic10/TraderControl/Trader Horz Input.ic10";

/** A script's code after its settings: the part the Horz and Vert copies share. */
const shared = (path: string) => readRepoScript(path).split("# The Horz and Vert copies are the same from here on.")[1];

describe("Trader Vert Input", () => {
	// Copied from the Horz script, it once zeroed the horizontal display on startup.
	describeTraderInput(SPEC);

	it("is the Horz script apart from its settings", () => {
		expect(shared(SPEC.script)).toBeDefined();
		expect(shared(SPEC.script)).toEqual(shared(HORZ));
	});

	it("keeps the tilt between 0 and 90", async () => {
		const world = await startConsole(SPEC);
		await pressButton(world, "Sub 1");
		expect(world.device("value")).toHaveProps({ Setting: 0 });

		for (let i = 0; i < 10; i++) await pressButton(world, "Add 10");
		expect(world.device("value")).toHaveProps({ Setting: 90 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("caps a typed tilt at 90", async () => {
		const world = await startConsole(SPEC);
		await typeValue(world, 400);
		expect(world.device("value")).toHaveProps({ Setting: 90 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
