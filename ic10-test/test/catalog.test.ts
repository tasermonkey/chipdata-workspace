import { describe, expect, it } from "vitest";
import { buildCatalog, parseEnglishXml, type SourceDevice } from "../src/catalog/build.ts";
import { stationpediaDescriptions, stationpediaPrefab, logicDifferences } from "../src/catalog/stationpedia.ts";
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

	it("takes each description from the first source that has it, and lists what none describe", () => {
		const { catalog, undescribed } = buildCatalog({
			devices: [VENT],
			descriptions: [
				{ source: "stationpedia", label: "Stationpedia export", data: { logicTypes: { Mode: "export mode" }, slotLogicTypes: {} } },
				{
					source: "game",
					label: "game english.xml",
					data: { logicTypes: { Mode: "game mode", Pressure: "game pressure" }, slotLogicTypes: { Occupied: "occupied" } },
				},
			],
		});
		expect(catalog.logicTypes.Mode).toEqual({ text: "export mode", source: "stationpedia" });
		expect(catalog.logicTypes.Pressure).toEqual({ text: "game pressure", source: "game" });
		expect(catalog.sources.descriptions).toBe("Stationpedia export, then game english.xml");
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

describe("the Stationpedia export", () => {
	const page = {
		PrefabName: "StructureFiltrationMirrored",
		PrefabHash: 42,
		Title: "Filtration (Mirrored)",
		ModeInsert: [
			{ LogicName: "Idle", LogicAccessTypes: "0" },
			{ LogicName: "Active", LogicAccessTypes: "1" },
		],
		Slots: [
			{ SlotName: "Gas Filter", SlotClass: "GasFilter" },
			{ SlotName: "ProgrammableChip", SlotClass: "ProgrammableChip" },
		],
		LogicInfo: {
			LogicTypes: { Mode: "ReadWrite", Pressure: "Read", Lock: "Write" },
			LogicSlotTypes: { "0": { Occupied: "Read", Quantity: "Read" }, "1": {} },
		},
	};

	it("turns a page into a mod prefab", () => {
		expect(stationpediaPrefab(page)).toEqual({
			prefab: "StructureFiltrationMirrored",
			hash: 42,
			title: "Filtration (Mirrored)",
			logic: { Mode: "rw", Pressure: "r", Lock: "w" },
			slots: [
				{ index: 0, name: "Gas Filter", type: "GasFilter", logic: ["Occupied", "Quantity"] },
				{ index: 1, name: "ProgrammableChip", type: "ProgrammableChip", logic: [] },
			],
			modes: ["Idle", "Active"],
			source: "mod",
		});
		expect(stationpediaPrefab({ ...page, LogicInfo: { LogicTypes: {}, LogicSlotTypes: {} } })).toBeUndefined(); // no logic
	});

	it("reads descriptions from Enums.json", () => {
		const enums = {
			scriptEnums: {
				LogicType: { values: { On: { value: 28, deprecated: false, description: "0 for off, 1 for on" }, Blank: { value: 1, deprecated: false, description: "" } } },
				LogicSlotType: { values: { Quantity: { value: 3, deprecated: false, description: "stack size" } } },
			},
		};
		expect(stationpediaDescriptions(enums)).toEqual({ logicTypes: { On: "0 for off, 1 for on" }, slotLogicTypes: { Quantity: "stack size" } });
	});

	it("lists game prefabs whose logic types differ from the emulator's data", () => {
		const exported = stationpediaPrefab({ ...page, PrefabName: "StructureFiltration" })!;
		expect(logicDifferences([exported], new Map([["StructureFiltration", ["Mode", "Pressure", "On"]]]))).toEqual([
			{ prefab: "StructureFiltration", added: ["Lock"], removed: ["On"] },
		]);
	});
});

describe("the built catalogue", () => {
	it("has the emulator's prefabs", () => {
		const vent = prefabInfo("StructureActiveVent")!;
		expect(vent.modes).toEqual(["Outward", "Inward"]); // review 1.3: Mode 0 is Outward
		expect(vent.logic).toMatchObject({ Mode: "rw", On: "rw", PressureExternal: "rw" });
		expect(prefabInfo("NoSuchPrefab")).toBeUndefined();
	});

	// Descriptions need the game or a Stationpedia export, so a clean clone (or CI) has none.
	it.skipIf(Object.keys(loadCatalog().logicTypes).length === 0)("has descriptions", () => {
		expect(loadCatalog().logicTypes.On?.text).toMatch(/0 for off, 1 for on/);
	});

	it("has the console mod's devices, from data/mods/", () => {
		expect(prefabInfo("ModularDeviceRoundButton")).toMatchObject({ source: "mod", logic: { Activate: "rw", Setting: "r" } });
		expect(prefabInfo("StationBatteryNuclear")?.logic).toMatchObject({ Ratio: "r", Charge: "r" });
	});
});
