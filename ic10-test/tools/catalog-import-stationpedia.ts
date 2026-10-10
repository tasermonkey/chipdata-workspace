/**
 * Regenerates ic10-test/data/mods/prefabs.json from the Stationpedia export: every prefab with logic
 * that the emulator's game data doesn't have (mods' devices), with its logic types, slots and modes.
 * Run after a game update or a mod change, then commit the file.
 *
 *   npm run catalog:import-stationpedia [-- <Stationpedia folder>]
 *
 * The folder defaults to <game>/Stationpedia (STATIONEERS_DIR or the default Steam path). Only
 * names, hashes and Read/Write are written; descriptions stay in the export (catalog:build reads
 * them from there).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEVICES } from "@stationeers-ic/ic10";
import type { CatalogPrefab } from "../src/catalog/catalog.ts";
import { type StationpediaPage, stationpediaPrefab, logicDifferences } from "../src/catalog/stationpedia.ts";
import { MODS_FILE, stationpediaDir } from "./game-paths.ts";

const dir = process.argv[2] ?? stationpediaDir();
if (!dir || !existsSync(join(dir, "Stationpedia.json"))) {
	console.error("No Stationpedia export found. Run `stationpedia_export` in game, or pass the folder that has Stationpedia.json.");
	process.exit(1);
}
const stationpedia = JSON.parse(readFileSync(join(dir, "Stationpedia.json"), "utf8")) as { version: string; pages: StationpediaPage[] };

const emulator = new Map(Object.values(DEVICES).map((d) => [d.PrefabName!, (d.logics ?? []).map((l) => l.name)]));
const exported = stationpedia.pages.map(stationpediaPrefab).filter((p): p is CatalogPrefab => p !== undefined);
const mods = exported.filter((p) => !emulator.has(p.prefab)).sort((a, b) => a.prefab.localeCompare(b.prefab));

const before: CatalogPrefab[] = existsSync(MODS_FILE)
	? (JSON.parse(readFileSync(MODS_FILE, "utf8")) as { prefabs: CatalogPrefab[] }).prefabs
	: [];
const old = new Map(before.map((p) => [p.prefab, JSON.stringify(p)]));
const added = mods.filter((p) => !old.has(p.prefab)).map((p) => p.prefab);
const changed = mods.filter((p) => old.has(p.prefab) && old.get(p.prefab) !== JSON.stringify(p)).map((p) => p.prefab);
const removed = before.map((p) => p.prefab).filter((name) => !mods.some((p) => p.prefab === name));

await mkdir(dirname(MODS_FILE), { recursive: true });
const file = { gameVersion: stationpedia.version, prefabs: mods };
await writeFile(MODS_FILE, `${JSON.stringify(file, null, "\t")}\n`);

console.log(`${mods.length} mod prefabs (game ${stationpedia.version}) → ${MODS_FILE}`);
const list = (names: string[]) => (names.length ? names.join(", ") : "none");
console.log(`  added: ${list(added)}\n  changed: ${list(changed)}\n  removed: ${list(removed)}`);

const differences = logicDifferences(exported, emulator);
if (differences.length) {
	console.log(`${differences.length} game prefabs have different logic types in the export than in the emulator's data`);
	console.log("(the catalogue keeps the emulator's, since that's what it enforces):");
	for (const { prefab, added: plus, removed: minus } of differences) {
		console.log(`  ${prefab}:${plus.length ? ` +${plus.join(" +")}` : ""}${minus.length ? ` -${minus.join(" -")}` : ""}`);
	}
}
