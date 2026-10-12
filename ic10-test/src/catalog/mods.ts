/**
 * Mods' devices: prefabs the emulator's game data doesn't have, from the Stationpedia exports
 * (`npm run catalog:import-stationpedia`). Each export is its own committed file, data/mods/<id>.json,
 * named for the machine that made it, so two machines never edit the same file. Each file also lists
 * the workshop mods installed when it was made, so differences between files can be traced to a mod.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogPrefab } from "./catalog.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Mods' data: one committed file per export, data/mods/<machine id>.json. */
export const MODS_DIR = join(ROOT, "data", "mods");

/** This machine's id, in .local/ (git-ignored), so it never reaches a commit. */
export const MACHINE_PATH = join(ROOT, ".local", "machine.json");

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
export function readMachineId(): string | undefined {
	return existsSync(MACHINE_PATH) ? (JSON.parse(readFileSync(MACHINE_PATH, "utf8")) as { id: string }).id : undefined;
}

/**
 * This machine's id, made on first use: a random 8-hex string, so the file it names can't say who
 * or where it is. Only the import calls this.
 */
export function machineId(): string {
	const existing = readMachineId();
	if (existing) return existing;
	const id = randomBytes(4).toString("hex");
	mkdirSync(dirname(MACHINE_PATH), { recursive: true });
	writeFileSync(MACHINE_PATH, `${JSON.stringify({ id }, null, "\t")}\n`);
	return id;
}

/** The export file this machine writes: data/mods/<machine id>.json. */
export function ownModsFile(): string {
	return join(MODS_DIR, `${machineId()}.json`);
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

let cached: Map<string, CatalogPrefab> | undefined;

/** Mods' prefabs by name, from every file in data/mods/ (empty if there are none). Warns about disagreements. */
export function modPrefabs(): Map<string, CatalogPrefab> {
	if (!cached) {
		const files: ModsFile[] = existsSync(MODS_DIR)
			? readdirSync(MODS_DIR)
					.filter((name) => name.endsWith(".json"))
					.map((name) => ({ name: basename(name), ...(JSON.parse(readFileSync(join(MODS_DIR, name), "utf8")) as Omit<ModsFile, "name">) }))
			: [];
		const id = readMachineId();
		const localName = id && `${id}.json`;
		const { prefabs, disagreements } = mergeModPrefabs(files, localName);
		for (const { file, prefabs: names } of disagreements) {
			const winner = localName ? "the local export, which wins" : "the first export by name, which wins";
			console.warn(`mods: ${names.length} prefab(s) in ${file} have different logic from ${winner} (e.g. ${names.slice(0, 3).join(", ")})`);
		}
		cached = prefabs;
	}
	return cached;
}
