/**
 * Mods' devices: prefabs the emulator's game data doesn't have, from the Stationpedia export
 * (`npm run catalog:import-stationpedia`). Committed, so tests can use them without building the
 * catalogue.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogPrefab } from "./catalog.ts";

export const MODS_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "mods", "prefabs.json");

let cached: Map<string, CatalogPrefab> | undefined;

/** Mods' prefabs by name (empty if data/mods/prefabs.json doesn't exist). */
export function modPrefabs(): Map<string, CatalogPrefab> {
	if (!cached) {
		const prefabs = existsSync(MODS_PATH)
			? (JSON.parse(readFileSync(MODS_PATH, "utf8")) as { prefabs: CatalogPrefab[] }).prefabs
			: [];
		cached = new Map(prefabs.map((p) => [p.prefab, p]));
	}
	return cached;
}
