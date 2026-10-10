import { describe, expect, it } from "vitest";
import { buildCatalog, parseEnglishXml, type SourceDevice } from "../src/catalog/build.ts";
import { canAccess, type CatalogPrefab, loadCatalog, prefabInfo } from "../src/catalog/catalog.ts";

const VENT: SourceDevice = {
	PrefabName: "StructureActiveVent",
	PrefabHash: -1129453144,
	Title: "Active Vent",
	mods: ["Outward", "Inward"],
	logics: [
		{ name: "Mode", permissions: ["Read", "Write"] },
		{ name: "PressureExternal", permissions: ["Read", "Write"] },
		{ name: "Pressure", permissions: ["Read"] },
		{ name: "Lock", permissions: ["Write"] },
	],
	slots: [{ SlotName: "", SlotType: "DataDisk", SlotIndex: 0, logic: ["Occupied"] }],
};

describe("buildCatalog", () => {
	it("keeps each prefab's logic types with Read/Write, its slots and its modes", () => {
		const { catalog } = buildCatalog({ devices: [VENT] });
		const vent = catalog.prefabs.StructureActiveVent!;
		expect(vent).toMatchObject({ hash: -1129453144, title: "Active Vent", modes: ["Outward", "Inward"], source: "game" });
		expect(vent.logic).toEqual({ Mode: "rw", PressureExternal: "rw", Pressure: "r", Lock: "w" });
		expect(vent.slots).toEqual([{ index: 0, name: "", type: "DataDisk", logic: ["Occupied"] }]);
		expect(canAccess(vent, "Pressure", "r")).toBe(true);
		expect(canAccess(vent, "Pressure", "w")).toBe(false);
		expect(canAccess(vent, "Nonsense", "r")).toBe(false);
	});

	it("takes descriptions from the game, and lists what it doesn't describe", () => {
		const { catalog, undescribed } = buildCatalog({
			devices: [VENT],
			game: { logicTypes: { Mode: "game mode", Pressure: "game pressure" }, slotLogicTypes: { Occupied: "occupied" } },
			gameLabel: "game english.xml",
		});
		expect(catalog.logicTypes.Mode).toEqual({ text: "game mode", source: "game" });
		expect(catalog.sources.descriptions).toBe("game english.xml");
		expect(undescribed).toEqual({ logicTypes: ["Lock", "PressureExternal"], slotLogicTypes: [] });
	});

	it("works without the game, with no descriptions", () => {
		const { catalog, undescribed } = buildCatalog({ devices: [VENT] });
		expect(catalog.logicTypes).toEqual({});
		expect(catalog.sources.descriptions).toMatch(/none/);
		expect(catalog.prefabs.StructureActiveVent?.logic.Mode).toBe("rw");
		expect(undescribed.logicTypes).toHaveLength(4);
	});

	it("adds mod prefabs, and refuses one that clashes with a game prefab", () => {
		const mod: CatalogPrefab = {
			prefab: "ModularDeviceRoundButton",
			hash: 1,
			title: "Round Button",
			logic: { Activate: "rw" },
			slots: [],
			modes: [],
			source: "mod",
		};
		expect(buildCatalog({ devices: [VENT], modPrefabs: [mod] }).catalog.prefabs.ModularDeviceRoundButton).toEqual(mod);
		expect(() => buildCatalog({ devices: [VENT], modPrefabs: [{ ...mod, prefab: "StructureActiveVent" }] })).toThrow(
			/clashes/,
		);
	});
});

describe("description sources", () => {
	it("reads LogicType and LogicSlotType records from the game's english.xml", () => {
		const xml = `
			<Record><Key>LogicTypeOn</Key><Value>The current state of the device, 0 for off, 1 for on</Value></Record>
			<Record><Key>LogicSlotTypeQuantity</Key><Value>Stack size &amp; such</Value></Record>
			<Record><Key>ThingStructureActiveVent</Key><Value>Not a logic type</Value></Record>`;
		expect(parseEnglishXml(xml)).toEqual({
			logicTypes: { On: "The current state of the device, 0 for off, 1 for on" },
			slotLogicTypes: { Quantity: "Stack size & such" },
		});
	});
});

describe("the built catalogue", () => {
	it("has the emulator's prefabs, with descriptions", () => {
		const vent = prefabInfo("StructureActiveVent")!;
		expect(vent.modes).toEqual(["Outward", "Inward"]); // review 1.3: Mode 0 is Outward
		expect(vent.logic).toMatchObject({ Mode: "rw", On: "rw", PressureExternal: "rw" });
		expect(loadCatalog().logicTypes.On?.text).toMatch(/0 for off, 1 for on/);
		expect(prefabInfo("NoSuchPrefab")).toBeUndefined();
	});
});
