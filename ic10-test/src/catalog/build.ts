/** Builds the catalogue from its sources. Kept free of file access so it can be tested directly. */
import type { Access, Catalog, CatalogDescription, CatalogPrefab } from "./catalog.ts";

/** The parts of the emulator's DEVICES entries the catalogue uses. */
export interface SourceDevice {
	PrefabName: string | null;
	PrefabHash: number | null;
	Title: string | null;
	mods?: string[] | null;
	logics?: { name: string; permissions?: string[] | null }[] | null;
	slots?: { SlotName: string; SlotType: string; SlotIndex: number; logic?: string[] | null }[] | null;
}

/** name → description text, for logic types and slot logic types. */
export interface Descriptions {
	logicTypes: Record<string, string>;
	slotLogicTypes: Record<string, string>;
}

export interface CatalogSources {
	devices: SourceDevice[];
	/** Mods' devices (data/mods/), added after the game's; a name clash is an error. */
	modPrefabs?: CatalogPrefab[];
	/** From the game's english.xml, when installed; without it, nothing has a description. */
	game?: Descriptions;
	/** Where `game` came from, for `sources.descriptions`. */
	gameLabel?: string;
	builtAt?: Date;
}

export interface BuildResult {
	catalog: Catalog;
	/** Logic types that prefabs use but have no description. */
	undescribed: { logicTypes: string[]; slotLogicTypes: string[] };
}

export function access(permissions: readonly string[]): Access | undefined {
	const read = permissions.includes("Read");
	const write = permissions.includes("Write");
	return read && write ? "rw" : read ? "r" : write ? "w" : undefined;
}

export function buildCatalog(sources: CatalogSources): BuildResult {
	const prefabs: Record<string, CatalogPrefab> = {};

	for (const device of sources.devices) {
		if (!device.PrefabName || device.PrefabHash === null) continue;
		const logic: Record<string, Access> = {};
		for (const { name, permissions } of device.logics ?? []) {
			const a = access(permissions ?? []);
			if (a) logic[name] = a;
		}
		prefabs[device.PrefabName] = {
			prefab: device.PrefabName,
			hash: device.PrefabHash,
			title: device.Title ?? device.PrefabName,
			logic,
			slots: (device.slots ?? []).map((s) => ({ index: s.SlotIndex, name: s.SlotName, type: s.SlotType, logic: s.logic ?? [] })),
			modes: device.mods ?? [],
			source: "game",
		};
	}
	for (const prefab of sources.modPrefabs ?? []) {
		if (prefabs[prefab.prefab]) throw new Error(`mod prefab ${prefab.prefab} clashes with a game prefab`);
		prefabs[prefab.prefab] = prefab;
	}

	const describe = (kind: keyof Descriptions): Record<string, CatalogDescription> => {
		const out: Record<string, CatalogDescription> = {};
		for (const [name, text] of Object.entries(sources.game?.[kind] ?? {})) out[name] = { text, source: "game" };
		return out;
	};
	const logicTypes = describe("logicTypes");
	const slotLogicTypes = describe("slotLogicTypes");
	const all = Object.values(prefabs);
	const undescribed = (used: string[], described: Record<string, unknown>) =>
		[...new Set(used)].filter((name) => !described[name]).sort();

	return {
		catalog: {
			version: 1,
			builtAt: (sources.builtAt ?? new Date()).toISOString(),
			sources: { descriptions: sources.game ? (sources.gameLabel ?? "game") : "none (game not found)" },
			logicTypes,
			slotLogicTypes,
			prefabs,
		},
		undescribed: {
			logicTypes: undescribed(all.flatMap((p) => Object.keys(p.logic)), logicTypes),
			slotLogicTypes: undescribed(all.flatMap((p) => p.slots.flatMap((s) => s.logic)), slotLogicTypes),
		},
	};
}

/** The LogicType and LogicSlotType records from the game's Language/english.xml. */
export function parseEnglishXml(xml: string): Descriptions {
	const out: Descriptions = { logicTypes: {}, slotLogicTypes: {} };
	const record = /<Key>(LogicSlotType|LogicType)(\w+)<\/Key>\s*<Value>([\s\S]*?)<\/Value>/g;
	for (const [, kind, name, value] of xml.matchAll(record)) {
		const target = kind === "LogicType" ? out.logicTypes : out.slotLogicTypes;
		target[name!] = unescapeXml(value!.trim());
	}
	return out;
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, "&");
}
