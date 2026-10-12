import { describe, expect, it } from "vitest";
import type { CatalogPrefab } from "../src/catalog/catalog.ts";
import { mergeModPrefabs, parseAboutXml } from "../src/catalog/mods.ts";

const device = (name: string, logic: CatalogPrefab["logic"] = { Setting: "rw" }): CatalogPrefab => ({
	prefab: name,
	hash: 1,
	title: name,
	logic,
	slots: [],
	modes: [],
	source: "mod",
});

describe("mergeModPrefabs", () => {
	it("merges the other files' prefabs in by name", () => {
		const { prefabs, disagreements } = mergeModPrefabs(
			[
				{ name: "local.json", prefabs: [device("A")] },
				{ name: "other.json", prefabs: [device("B")] },
			],
			"local.json",
		);
		expect([...prefabs.keys()].sort()).toEqual(["A", "B"]);
		expect(disagreements).toEqual([]);
	});

	it("keeps the local file's logic where another file disagrees, and reports that file", () => {
		const { prefabs, disagreements } = mergeModPrefabs(
			[
				{ name: "other.json", prefabs: [device("A", { Setting: "r" })] },
				{ name: "local.json", prefabs: [device("A", { Setting: "rw" })] },
			],
			"local.json",
		);
		expect(prefabs.get("A")!.logic).toEqual({ Setting: "rw" });
		expect(disagreements).toEqual([{ file: "other.json", prefabs: ["A"] }]);
	});

	it("doesn't report files that agree", () => {
		const { disagreements } = mergeModPrefabs(
			[
				{ name: "local.json", prefabs: [device("A")] },
				{ name: "other.json", prefabs: [device("A")] },
			],
			"local.json",
		);
		expect(disagreements).toEqual([]);
	});

	it("with no local file, the first by name wins", () => {
		const { prefabs } = mergeModPrefabs([
			{ name: "b.json", prefabs: [device("A", { Setting: "r" })] },
			{ name: "a.json", prefabs: [device("A", { Setting: "rw" })] },
		]);
		expect(prefabs.get("A")!.logic).toEqual({ Setting: "rw" });
	});
});

describe("parseAboutXml", () => {
	it("reads the name and version", () => {
		const xml = `<?xml version="1.0"?>\n<ModMetadata>\n  <Name>Stacked!</Name>\n  <Author>Adaxity</Author>\n  <Version>2.5169</Version>\n</ModMetadata>`;
		expect(parseAboutXml(xml)).toEqual({ name: "Stacked!", version: "2.5169" });
	});

	it("returns undefined without both", () => {
		expect(parseAboutXml("<ModMetadata><Name>X</Name></ModMetadata>")).toBeUndefined();
	});
});
