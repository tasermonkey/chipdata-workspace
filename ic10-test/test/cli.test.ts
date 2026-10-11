import { describe, expect, it } from "vitest";
import type { Catalog, CatalogPrefab } from "../src/catalog/catalog.ts";
import { describeLogic, describePrefab, findLogicTypes, findPrefabs, listPrefabs } from "../src/cli/lookup.ts";

const prefab = (p: Partial<CatalogPrefab> & Pick<CatalogPrefab, "prefab" | "title">): CatalogPrefab => ({
	hash: 1,
	logic: {},
	slots: [],
	modes: [],
	source: "game",
	...p,
});

const CATALOG: Catalog = {
	version: 1,
	builtAt: "2026-10-10T00:00:00.000Z",
	sources: { descriptions: "game english.xml" },
	logicTypes: {
		Mode: { text: "Integer for mode state", source: "game" },
		Color: { text: "The colour.\n\n0: Blue\n1: Grey", source: "game" },
	},
	slotLogicTypes: {},
	prefabs: {
		StructureActiveVent: prefab({
			prefab: "StructureActiveVent",
			title: "Active Vent",
			hash: -1129453144,
			logic: { Mode: "rw", PressureOutput: "r" },
			modes: ["Outward", "Inward"],
			slots: [{ index: 0, name: "Data Disk", type: "DataDisk", logic: ["Occupied"] }],
		}),
		ModularDeviceRoundButton: prefab({
			prefab: "ModularDeviceRoundButton",
			title: "Logic Button Round",
			hash: 489382030,
			logic: { Color: "rw" },
			source: "mod",
		}),
		ModularDeviceSquareButton: prefab({ prefab: "ModularDeviceSquareButton", title: "Logic Button Square", hash: 2, source: "mod" }),
	},
};

describe("findPrefabs", () => {
	it("finds by exact name, by hash, or by every word of the name or title", () => {
		expect(findPrefabs(CATALOG, "StructureActiveVent").map((p) => p.prefab)).toEqual(["StructureActiveVent"]);
		expect(findPrefabs(CATALOG, "489382030").map((p) => p.prefab)).toEqual(["ModularDeviceRoundButton"]);
		expect(findPrefabs(CATALOG, "round button").map((p) => p.prefab)).toEqual(["ModularDeviceRoundButton"]);
		expect(findPrefabs(CATALOG, "BUTTON").map((p) => p.prefab)).toEqual(["ModularDeviceRoundButton", "ModularDeviceSquareButton"]);
		expect(findPrefabs(CATALOG, "nothing")).toEqual([]);
	});
});

describe("describePrefab", () => {
	it("shows the prefab's logic types with R/W and descriptions, its modes and its slots", () => {
		expect(describePrefab(CATALOG, CATALOG.prefabs.StructureActiveVent!)).toBe(
			[
				"StructureActiveVent  Active Vent",
				"hash -1129453144, game",
				"",
				"Logic type      R/W  Description",
				"Mode            RW   Integer for mode state",
				"PressureOutput  R",
				"",
				"Modes: 0 Outward, 1 Inward",
				"",
				"Slots:",
				"  0  Data Disk (DataDisk): Occupied",
			].join("\n"),
		);
	});

	it("puts a multi-line description on one line, and says when a device is a mod's", () => {
		const text = describePrefab(CATALOG, CATALOG.prefabs.ModularDeviceRoundButton!);
		expect(text).toContain("a mod's device (data/mods/)");
		expect(text).toContain("Color       RW   The colour. 0: Blue 1: Grey");
	});

	it("says when the catalogue has no descriptions", () => {
		const bare = { ...CATALOG, sources: { descriptions: "none (game not found)" } };
		expect(describePrefab(bare, CATALOG.prefabs.StructureActiveVent!)).toMatch(/No descriptions/);
	});
});

describe("logic lookups", () => {
	it("describe a logic type and list the prefabs that have it", () => {
		expect(describeLogic(CATALOG, "Mode")).toBe(
			["Mode", "Integer for mode state", "", "1 prefab:", "  StructureActiveVent  RW  Active Vent"].join("\n"),
		);
		expect(describeLogic(CATALOG, "Nothing")).toBeUndefined();
	});

	it("find logic type names by part of the name", () => {
		expect(findLogicTypes(CATALOG, "press")).toEqual(["PressureOutput"]);
	});
});

it("lists several prefabs, marking mods' devices", () => {
	expect(listPrefabs(findPrefabs(CATALOG, "button"))).toBe(
		["ModularDeviceRoundButton   Logic Button Round   (mod)", "ModularDeviceSquareButton  Logic Button Square  (mod)"].join("\n"),
	);
});
