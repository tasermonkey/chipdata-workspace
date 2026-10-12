/**
 * The device and property catalogue (plan §6): which logic types and slots each prefab has, with
 * Read/Write, and a description of every logic type.
 *
 * Two copies. The package ships generated/catalog.json: the emulator's prefabs, with no
 * descriptions (those are the game's text). `ic10-bench catalog` builds the project's own in
 * .ic10-bench/catalog.json: the same prefabs plus the project's mods (ic10-mods/), with descriptions
 * from a local Stationpedia export, then the installed game's english.xml (none without either).
 * The project's copy wins; without it, the packaged one is used with the project's mods added.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPaths } from "../project.ts";
import { modPrefabs } from "./mods.ts";

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
	/** "game": the emulator's game data. "mod": a device it doesn't have, from the project's ic10-mods/ (the export). */
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

/** The package's generated files (dist/generated/ once built, as the paths are relative to this file). */
export const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "generated");
export const PACKAGED_CATALOG_PATH = join(GENERATED_DIR, "catalog.json");

const cached = new Map<string, Catalog>();

/** The packaged catalogue: the emulator's prefabs, no descriptions. */
export function loadPackagedCatalog(): Catalog {
	try {
		return JSON.parse(readFileSync(PACKAGED_CATALOG_PATH, "utf8")) as Catalog;
	} catch {
		throw new Error(`No device catalogue at ${PACKAGED_CATALOG_PATH}. Run \`npm run catalog:build\` in the ic10-bench package.`);
	}
}

/**
 * The project's catalogue (`ic10-bench catalog`), or else the packaged one with the project's
 * mods added. `root` defaults to the project ({@link projectPaths}).
 */
export function loadCatalog(root?: string): Catalog {
	const paths = projectPaths(root);
	let catalog = cached.get(paths.root);
	if (catalog) return catalog;
	if (existsSync(paths.catalog)) {
		catalog = JSON.parse(readFileSync(paths.catalog, "utf8")) as Catalog;
	} else {
		const packaged = loadPackagedCatalog();
		const mods = Object.fromEntries([...modPrefabs(paths.root)].map(([name, prefab]) => [name, { ...prefab, source: "mod" as const }]));
		catalog = { ...packaged, prefabs: { ...mods, ...packaged.prefabs } };
	}
	cached.set(paths.root, catalog);
	return catalog;
}

/** A prefab's entry, or undefined if the catalogue doesn't know it. */
export function prefabInfo(prefab: string): CatalogPrefab | undefined {
	return loadCatalog().prefabs[prefab];
}

/** Whether `prefab` has logic type `logic` with the access needed (`"r"` or `"w"`). */
export function canAccess(prefab: CatalogPrefab, logic: string, access: "r" | "w"): boolean {
	return prefab.logic[logic]?.includes(access) ?? false;
}
