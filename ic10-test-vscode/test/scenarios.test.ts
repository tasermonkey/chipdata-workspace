import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEnvJson, scenarioFor } from "../src/scenarios.ts";

const ENV = JSON.stringify({ version: 1, chips: [], networks: [], devices: [] });

/** A folder with these files in it. */
function folder(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "ic10-scenarios-"));
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	return dir;
}

describe("scenarioFor", () => {
	it("takes a world module as itself", () => {
		expect(scenarioFor("/x/greenhouse.world.ts")).toEqual({ scenario: "/x/greenhouse.world.ts" });
		expect(scenarioFor("/x/greenhouse.world.mjs")).toEqual({ scenario: "/x/greenhouse.world.mjs" });
		expect(scenarioFor("/x/greenhouse.ts")).toBeUndefined();
	});

	it("takes env JSON as itself, with the .ic10 of the same name as its program", () => {
		const dir = folder({ "a.env.json": ENV, "a.ic10": "yield", "b.json": ENV, "c.json": '{"name":"not env"}' });
		expect(scenarioFor(join(dir, "a.env.json"))).toEqual({ scenario: join(dir, "a.env.json"), program: join(dir, "a.ic10") });
		expect(scenarioFor(join(dir, "b.json"))).toEqual({ scenario: join(dir, "b.json") });
		expect(scenarioFor(join(dir, "c.json"))).toBeUndefined();
		// The editor's text wins over the file's.
		expect(scenarioFor(join(dir, "c.json"), ENV)).toEqual({ scenario: join(dir, "c.json") });
	});

	it("takes an .ic10 to the world module beside it, or else the env JSON with it as the program", () => {
		const dir = folder({
			"a.ic10": "",
			"a.world.ts": "",
			"a.env.json": ENV,
			"b.ic10": "",
			"b.env.json": ENV,
			"c.ic10": "",
			"c.json": "{}",
			"d.ic10": "",
		});
		expect(scenarioFor(join(dir, "a.ic10"))).toEqual({ scenario: join(dir, "a.world.ts") });
		expect(scenarioFor(join(dir, "b.ic10"))).toEqual({ scenario: join(dir, "b.env.json"), program: join(dir, "b.ic10") });
		expect(scenarioFor(join(dir, "c.ic10"))).toBeUndefined(); // c.json isn't env JSON
		expect(scenarioFor(join(dir, "d.ic10"))).toBeUndefined();
	});

	it("finds the examples' scenario from its script", () => {
		const examples = join(import.meta.dirname, "..", "examples");
		expect(scenarioFor(join(examples, "scenario.ic10"))).toEqual({ scenario: join(examples, "scenario.world.ts") });
		expect(scenarioFor(join(examples, "scenario.env.json"))).toEqual({
			scenario: join(examples, "scenario.env.json"),
			program: join(examples, "scenario.ic10"),
		});
	});
});

describe("isEnvJson", () => {
	it("needs chips and devices lists", () => {
		expect(isEnvJson(ENV)).toBe(true);
		expect(isEnvJson('{"chips":[]}')).toBe(false);
		expect(isEnvJson("not json")).toBe(false);
		expect(isEnvJson(undefined)).toBe(false);
	});
});
