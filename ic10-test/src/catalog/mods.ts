/**
 * Mods' devices: prefabs the emulator's game data doesn't have, from the Stationpedia exports
 * (`ic10-bench import-mods`). Each export is its own committed file in the project,
 * ic10-mods/<id>.json, named for the machine that made it, so two machines never edit the same file.
 * Each file also lists the workshop mods installed when it was made, so differences between files
 * can be traced to a mod.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { projectPaths } from "../project.ts";
import type { CatalogPrefab } from "./catalog.ts";

/** A workshop mod, from its About/About.xml. */
export interface InstalledMod {
	workshopId: string;
	name: string;
	version: string;
}

/** One export file: its prefabs, and the mods installed when it was made. */
export interface ModsFile {
	name: string;
	installedMods?: InstalledMod[];
	prefabs: CatalogPrefab[];
}

/** This machine's id, or undefined if it hasn't been made yet. Reading never creates one. */
export function readMachineId(root?: string): string | undefined {
	const path = projectPaths(root).machine;
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { id: string }).id : undefined;
}

/**
 * This machine's id, made on first use: a random 8-hex string, so the file it names can't say who
 * or where it is. Only the import calls this.
 */
export function machineId(root?: string): string {
	const existing = readMachineId(root);
	if (existing) return existing;
	const id = randomBytes(4).toString("hex");
	const path = projectPaths(root).machine;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ id }, null, "\t")}\n`);
	return id;
}

/** The export file this machine writes: ic10-mods/<machine id>.json. */
export function ownModsFile(root?: string): string {
	return join(projectPaths(root).mods, `${machineId(root)}.json`);
}

/** The name and version from a workshop mod's About/About.xml. */
export function parseAboutXml(xml: string): { name: string; version: string } | undefined {
	const name = /<Name>([^<]*)<\/Name>/.exec(xml)?.[1]?.trim();
	const version = /<Version>([^<]*)<\/Version>/.exec(xml)?.[1]?.trim();
	return name && version ? { name, version } : undefined;
}

/** The workshop mods in a workshop content folder (one subfolder per mod, named by its id), sorted by id. */
export function readInstalledMods(workshopDir: string): InstalledMod[] {
	const mods: InstalledMod[] = [];
	for (const workshopId of readdirSync(workshopDir).sort()) {
		const about = join(workshopDir, workshopId, "About", "About.xml");
		if (!existsSync(about)) continue;
		const meta = parseAboutXml(readFileSync(about, "utf8"));
		if (meta) mods.push({ workshopId, ...meta });
	}
	return mods;
}

/** One export file's prefabs that differ from the one kept, by the file that disagrees. */
export interface Disagreement {
	file: string;
	prefabs: string[];
}

export interface ModsMerge {
	prefabs: Map<string, CatalogPrefab>;
	disagreements: Disagreement[];
}

/**
 * The union of the export files, by prefab name. The local machine's file (`localName`) wins; the
 * rest are merged in by name, the first by name winning among them. A prefab whose logic differs
 * from the one kept is reported against the file that gave it.
 */
export function mergeModPrefabs(files: ModsFile[], localName?: string): ModsMerge {
	const ordered = [...files].sort((a, b) => {
		if (a.name === localName) return -1;
		if (b.name === localName) return 1;
		return a.name.localeCompare(b.name);
	});
	const prefabs = new Map<string, CatalogPrefab>();
	const disagreements = new Map<string, Disagreement>();
	for (const file of ordered) {
		for (const prefab of file.prefabs) {
			const kept = prefabs.get(prefab.prefab);
			if (!kept) {
				prefabs.set(prefab.prefab, prefab);
				continue;
			}
			if (JSON.stringify(kept.logic) === JSON.stringify(prefab.logic)) continue;
			const entry = disagreements.get(file.name) ?? { file: file.name, prefabs: [] };
			entry.prefabs.push(prefab.prefab);
			disagreements.set(file.name, entry);
		}
	}
	return { prefabs, disagreements: [...disagreements.values()] };
}

const cached = new Map<string, Map<string, CatalogPrefab>>();

/**
 * Mods' prefabs by name, from every file in the project's ic10-mods/ (empty if there are none).
 * Warns about disagreements.
 */
export function modPrefabs(root?: string): Map<string, CatalogPrefab> {
	const paths = projectPaths(root);
	let prefabs = cached.get(paths.root);
	if (!prefabs) {
		const files: ModsFile[] = existsSync(paths.mods)
			? readdirSync(paths.mods)
					.filter((name) => name.endsWith(".json"))
					.map((name) => ({ name: basename(name), ...(JSON.parse(readFileSync(join(paths.mods, name), "utf8")) as Omit<ModsFile, "name">) }))
			: [];
		const id = readMachineId(paths.root);
		const localName = id && `${id}.json`;
		const merged = mergeModPrefabs(files, localName);
		for (const { file, prefabs: names } of merged.disagreements) {
			const winner = localName ? "the local export, which wins" : "the first export by name, which wins";
			console.warn(`mods: ${names.length} prefab(s) in ${file} have different logic from ${winner} (e.g. ${names.slice(0, 3).join(", ")})`);
		}
		prefabs = merged.prefabs;
		cached.set(paths.root, prefabs);
	}
	return prefabs;
}
