/**
 * Reads the Stationpedia export (Ryex/StationeersStationpediaExtractor: `stationpedia_export` in the
 * game's F3 console writes Stationpedia/Stationpedia.json and Enums.json into the game folder).
 */
import type { Access, CatalogPrefab } from "./catalog.ts";
import type { Descriptions } from "./build.ts";

/** The parts of a Stationpedia.json page the catalogue uses. */
export interface StationpediaPage {
	PrefabName: string | null;
	PrefabHash: number | null;
	Title: string | null;
	ModeInsert?: { LogicName: string; LogicAccessTypes: string }[] | null;
	Slots?: { SlotName: string; SlotClass: string }[] | null;
	LogicInfo?: {
		LogicTypes: Record<string, string>;
		LogicSlotTypes: Record<string, Record<string, string>>;
	} | null;
}

export interface StationpediaEnums {
	scriptEnums: Record<string, { values: Record<string, { value: number; deprecated: boolean; description: string }> }>;
}

const ACCESS: Record<string, Access> = { Read: "r", Write: "w", ReadWrite: "rw" };

/** A page as a catalogue prefab, or undefined if it has no logic. */
export function stationpediaPrefab(page: StationpediaPage): CatalogPrefab | undefined {
	const types = page.LogicInfo?.LogicTypes ?? {};
	if (!page.PrefabName || page.PrefabHash === null || !Object.keys(types).length) return undefined;
	const logic: Record<string, Access> = {};
	for (const [name, access] of Object.entries(types)) {
		const a = ACCESS[access];
		if (!a) throw new Error(`${page.PrefabName}.${name}: unknown access ${access}`);
		logic[name] = a;
	}
	const modes: string[] = [];
	for (const { LogicName, LogicAccessTypes } of page.ModeInsert ?? []) modes[Number(LogicAccessTypes)] = LogicName;
	return {
		prefab: page.PrefabName,
		hash: page.PrefabHash,
		title: page.Title ?? page.PrefabName,
		logic,
		slots: (page.Slots ?? []).map((slot, index) => ({
			index,
			name: slot.SlotName,
			type: slot.SlotClass,
			logic: Object.keys(page.LogicInfo?.LogicSlotTypes[index] ?? {}),
		})),
		modes: Array.from(modes, (m) => m ?? ""),
		source: "mod",
	};
}

/** The LogicType and LogicSlotType descriptions from Enums.json. */
export function stationpediaDescriptions(enums: StationpediaEnums): Descriptions {
	const texts = (name: string) =>
		Object.fromEntries(
			Object.entries(enums.scriptEnums[name]?.values ?? {})
				.filter(([, v]) => v.description)
				.map(([k, v]) => [k, v.description]),
		);
	return { logicTypes: texts("LogicType"), slotLogicTypes: texts("LogicSlotType") };
}

export interface LogicDifference {
	prefab: string;
	/** In the export but not in the emulator's data. */
	added: string[];
	/** In the emulator's data but not in the export. */
	removed: string[];
}

/** Prefabs whose logic types differ between the export and the emulator's data. */
export function logicDifferences(exported: CatalogPrefab[], emulator: Map<string, string[]>): LogicDifference[] {
	const out: LogicDifference[] = [];
	for (const prefab of exported) {
		const known = emulator.get(prefab.prefab);
		if (!known) continue;
		const names = Object.keys(prefab.logic);
		const added = names.filter((n) => !known.includes(n));
		const removed = known.filter((n) => !names.includes(n));
		if (added.length || removed.length) out.push({ prefab: prefab.prefab, added, removed });
	}
	return out;
}
