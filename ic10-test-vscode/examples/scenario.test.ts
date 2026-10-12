// Launching from a scenario: see scenario.ic10. This test only checks that both forms of the
// scenario load and behave; the debugger runs them with no test at all.
import { join } from "node:path";
import { loadScenario } from "@tasermonkey/ic10-bench/run-scenario";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;

describe("scenario", () => {
	it("as a world module: counts the nights", async () => {
		const world = await loadScenario(join(here, "scenario.world.ts"));
		await world.runTicks(200); // nightfall at 30, 90, 150
		expect(world.chip("ic")).toHaveRegister("Nights", 3);
		expect(world.chip("ic").path).toBe(join(here, "scenario.ic10"));
	});

	it("as env JSON with scenario.ic10 as its program: dark from the start", async () => {
		const world = await loadScenario(join(here, "scenario.env.json"), { program: join(here, "scenario.ic10") });
		await world.runTicks(5);
		expect(world.chip("ic")).toHaveRegister("Nights", 1);
		expect(world.device("light")).toHaveProps({ On: 1 });
		expect(world.chip("ic").path).toBe(join(here, "scenario.ic10"));
	});
});
