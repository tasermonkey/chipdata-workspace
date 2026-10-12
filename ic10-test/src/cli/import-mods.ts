/**
 * `ic10-bench import-mods [<Stationpedia folder>]`: regenerates this machine's file of mods'
 * devices, ic10-mods/<machine id>.json in the project, from the Stationpedia export: every prefab
 * with logic that the emulator's game data doesn't have, with its logic types, slots and modes. Run
 * after a game update or a mod change, then commit that file. Each machine writes only its own
 * file, so the files never conflict; the loader reads them all.
 *
 * The folder defaults to <game>/Stationpedia (STATIONEERS_DIR or Steam). Only names, hashes and
 * Read/Write are written; descriptions stay in the export (`ic10-bench catalog` reads them there).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { DEVICES } from "@tasermonkey/ic10";
import type { CatalogPrefab } from "../catalog/catalog.ts";
import { stationpediaDir, workshopDir } from "../catalog/game-paths.ts";
import { ownModsFile, readInstalledMods } from "../catalog/mods.ts";
import { logicDifferences, type StationpediaPage, stationpediaPrefab } from "../catalog/stationpedia.ts";
import { projectPaths } from "../project.ts";

/** Thrown when there's no export to read; the CLI prints its message alone. */
export class NoExportError extends Error {}

/** Imports the mods' devices; returns what to print. */
export async function importMods(folder?: string, root?: string): Promise<string[]> {
	const paths = projectPaths(root);
	const dir = folder ?? stationpediaDir();
	if (!dir || !existsSync(join(dir, "Stationpedia.json"))) {
		throw new NoExportError(
			"No Stationpedia export found. Run `stationpedia_export` in the game's console, or pass the folder that has Stationpedia.json.",
		);
	}
	const stationpedia = JSON.parse(readFileSync(join(dir, "Stationpedia.json"), "utf8")) as { version: string; pages: StationpediaPage[] };

	const emulator = new Map(Object.values(DEVICES).map((d) => [d.PrefabName!, (d.logics ?? []).map((l) => l.name)]));
	const exported = stationpedia.pages.map(stationpediaPrefab).filter((p): p is CatalogPrefab => p !== undefined);
	const mods = exported.filter((p) => !emulator.has(p.prefab)).sort((a, b) => a.prefab.localeCompare(b.prefab));

	const modsFile = ownModsFile(paths.root);
	const before: CatalogPrefab[] = existsSync(modsFile) ? (JSON.parse(readFileSync(modsFile, "utf8")) as { prefabs: CatalogPrefab[] }).prefabs : [];
	const old = new Map(before.map((p) => [p.prefab, JSON.stringify(p)]));
	const added = mods.filter((p) => !old.has(p.prefab)).map((p) => p.prefab);
	const changed = mods.filter((p) => old.has(p.prefab) && old.get(p.prefab) !== JSON.stringify(p)).map((p) => p.prefab);
	const removed = before.map((p) => p.prefab).filter((name) => !mods.some((p) => p.prefab === name));

	const lines: string[] = [];
	await mkdir(dirname(modsFile), { recursive: true });
	const workshop = workshopDir(dirname(dir));
	if (!workshop) lines.push("No Steam workshop folder found for the game; installedMods will be empty.");
	const installedMods = workshop ? readInstalledMods(workshop) : [];
	const file = { gameVersion: stationpedia.version, installedMods, prefabs: mods };
	await writeFile(modsFile, `${JSON.stringify(file, null, "\t")}\n`);

	lines.push(`${mods.length} mod prefabs, ${installedMods.length} workshop mods (game ${stationpedia.version}) → ${relative(paths.root, modsFile)}`);
	const list = (names: string[]) => (names.length ? names.join(", ") : "none");
	lines.push(`  added: ${list(added)}`, `  changed: ${list(changed)}`, `  removed: ${list(removed)}`);

	const differences = logicDifferences(exported, emulator);
	if (differences.length) {
		lines.push(`${differences.length} game prefabs have different logic types in the export than in the emulator's data`);
		lines.push("(the catalogue keeps the emulator's, since that's what it enforces):");
		for (const { prefab, added: plus, removed: minus } of differences) {
			lines.push(`  ${prefab}:${plus.length ? ` +${plus.join(" +")}` : ""}${minus.length ? ` -${minus.join(" -")}` : ""}`);
		}
	}
	lines.push("Run `ic10-bench catalog` to update the catalogue and types with them.");
	return lines;
}
