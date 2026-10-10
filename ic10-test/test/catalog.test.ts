import { describe, expect, it } from "vitest";
import { buildCatalog, parseEnglishXml, type SourceDevice } from "../src/catalog/build.ts";
import { canAccess, type CatalogPrefab, loadCatalog, prefabInfo } from "../src/catalog/catalog.ts";
import { parseEnum } from "../tools/import-ic10emu.ts";

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
		const { catalog } = buildCatalog({ devices: [VENT], fallback: { logicTypes: {}, slotLogicTypes: {} } });
		const vent = catalog.prefabs.StructureActiveVent!;
		expect(vent).toMatchObject({ hash: -1129453144, title: "Active Vent", modes: ["Outward", "Inward"], source: "game" });
		expect(vent.logic).toEqual({ Mode: "rw", PressureExternal: "rw", Pressure: "r", Lock: "w" });
		expect(vent.slots).toEqual([{ index: 0, name: "", type: "DataDisk", logic: ["Occupied"] }]);
		expect(canAccess(vent, "Pressure", "r")).toBe(true);
		expect(canAccess(vent, "Pressure", "w")).toBe(false);
		expect(canAccess(vent, "Nonsense", "r")).toBe(false);
	});

	it("prefers the game's descriptions, falls back to ic10emu's, and lists what neither describes", () => {
		const { catalog, undescribed } = buildCatalog({
			devices: [VENT],
			game: { logicTypes: { Mode: "game mode" }, slotLogicTypes: {} },
			fallback: { logicTypes: { Mode: "emu mode", Pressure: "emu pressure" }, slotLogicTypes: { Occupied: "emu occupied" } },
			gameLabel: "game english.xml",
		});
		expect(catalog.logicTypes.Mode).toEqual({ text: "game mode", source: "game" });
		expect(catalog.logicTypes.Pressure).toEqual({ text: "emu pressure", source: "ic10emu" });
		expect(catalog.sources.descriptions).toBe("game english.xml");
		expect(undescribed).toEqual({ logicTypes: ["Lock", "PressureExternal"], slotLogicTypes: [] });
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
		const fallback = { logicTypes: {}, slotLogicTypes: {} };
		expect(buildCatalog({ devices: [VENT], modPrefabs: [mod], fallback }).catalog.prefabs.ModularDeviceRoundButton).toEqual(mod);
		expect(() => buildCatalog({ devices: [VENT], modPrefabs: [{ ...mod, prefab: "StructureActiveVent" }], fallback })).toThrow(
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

	it("reads an enum from ic10emu's script.rs", () => {
		const rust = `
pub enum LogicType {
    #[strum(serialize = "None")]
    #[strum(props(deprecated = "true", docs = "No description", value = "0"))]
    None = 0u16,
    #[strum(serialize = "RatioNitrogenInput")]
    #[strum(
        props(docs = "The ratio of nitrogen in device's input network", value = "110")
    )]
    RatioNitrogenInput = 110u16,
}`;
		expect(parseEnum(rust, "LogicType")).toEqual({
			None: { value: 0, description: "No description", deprecated: true },
			RatioNitrogenInput: { value: 110, description: "The ratio of nitrogen in device's input network" },
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
