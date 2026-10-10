/**
 * The device and property catalogue (plan §6): which logic types and slots each prefab has, with
 * Read/Write, and a description of every logic type.
 *
 * `npm run catalog:build` writes it to ic10-test/generated/ (gitignored: the descriptions are the
 * game's text). Prefabs come from the emulator's game data plus mods' devices (data/mods/, from the
 * Stationpedia export); descriptions from a local Stationpedia export, then the installed game's
 * english.xml (none without either).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Access = "r" | "w" | "rw";

export interface CatalogSlot {
	index: number;
	name: string;
	type: string;
	logic: string[];
}

export interface CatalogPrefab {
	prefab: string;
	hash: number;
	title: string;
	/** Logic type → Read/Write. */
	logic: Record<string, Access>;
	slots: CatalogSlot[];
	/** Mode names; the index is the value. */
	modes: string[];
	/** "game": the emulator's game data. "mod": a device it doesn't have, from data/mods/ (the export). */
	source: "game" | "mod";
}

export interface CatalogDescription {
	text: string;
	/** "stationpedia": the Stationpedia export's Enums.json. "game": the game's english.xml. */
	source: "stationpedia" | "game";
}

export interface Catalog {
	version: 1;
	builtAt: string;
	sources: { descriptions: string };
	logicTypes: Record<string, CatalogDescription>;
	slotLogicTypes: Record<string, CatalogDescription>;
	prefabs: Record<string, CatalogPrefab>;
}

export const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "generated");
export const CATALOG_PATH = join(GENERATED_DIR, "catalog.json");

let cached: Catalog | undefined;

/** The built catalogue. Throws, saying how to build it, if `npm run catalog:build` hasn't run. */
export function loadCatalog(): Catalog {
	if (cached) return cached;
	let text: string;
	try {
		text = readFileSync(CATALOG_PATH, "utf8");
	} catch {
		throw new Error(`No device catalogue at ${CATALOG_PATH}. Run \`npm run catalog:build\`.`);
	}
	cached = JSON.parse(text) as Catalog;
	return cached;
}

/** A prefab's entry, or undefined if the catalogue doesn't know it. */
export function prefabInfo(prefab: string): CatalogPrefab | undefined {
	return loadCatalog().prefabs[prefab];
}

/** Whether `prefab` has logic type `logic` with the access needed (`"r"` or `"w"`). */
export function canAccess(prefab: CatalogPrefab, logic: string, access: "r" | "w"): boolean {
	return prefab.logic[logic]?.includes(access) ?? false;
}
