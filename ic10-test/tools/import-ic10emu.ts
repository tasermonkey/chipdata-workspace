/**
 * Refreshes ic10-test/data/ic10emu/: the LogicType and LogicSlotType descriptions from Ryex/ic10emu
 * (MIT OR Apache-2.0), which `catalog:build` uses when the game isn't installed (e.g. in CI).
 *
 *   node ic10-test/tools/import-ic10emu.ts [commit]
 *
 * The descriptions are the game's own text, as ic10emu extracted it; the game's english.xml is
 * preferred whenever it's available.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Ryex/ic10emu";
const DEFAULT_COMMIT = "138492b5b5505d637e311773979c8d1bcc52c871"; // develop, 2024-09-18
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "ic10emu");

export interface EnumEntry {
	value: number;
	description: string;
	deprecated?: true;
}

/** Parses one `pub enum Name { ... }` from ic10emu's script.rs into name → entry. */
export function parseEnum(source: string, name: string): Record<string, EnumEntry> {
	const start = source.indexOf(`pub enum ${name} {`);
	if (start < 0) throw new Error(`enum ${name} not found`);
	const body = source.slice(start, source.indexOf("\n}", start));
	const entries: Record<string, EnumEntry> = {};
	const variant = /#\[strum\(serialize = "(\w+)"\)\]\s*#\[strum\(\s*props\(([\s\S]*?)\)\s*\)\]\s*\w+ = (\d+)/g;
	for (const [, key, props, value] of body.matchAll(variant)) {
		const docs = /docs = "((?:[^"\\]|\\.)*)"/.exec(props!)?.[1] ?? "";
		const entry: EnumEntry = { value: Number(value), description: JSON.parse(`"${docs}"`) };
		if (/deprecated = "true"/.test(props!)) entry.deprecated = true;
		entries[key!] = entry;
	}
	return entries;
}

async function fetchText(path: string, commit: string): Promise<string> {
	const url = `https://raw.githubusercontent.com/${REPO}/${commit}/${path}`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response.text();
}

async function main(commit = DEFAULT_COMMIT): Promise<void> {
	const script = await fetchText("stationeers_data/src/enums/script.rs", commit);
	const data = {
		source: `https://github.com/${REPO}/blob/${commit}/stationeers_data/src/enums/script.rs`,
		logicTypes: parseEnum(script, "LogicType"),
		slotLogicTypes: parseEnum(script, "LogicSlotType"),
	};
	await mkdir(OUT, { recursive: true });
	await writeFile(join(OUT, "descriptions.json"), `${JSON.stringify(data, null, "\t")}\n`);
	for (const licence of ["LICENSE-MIT", "LICENSE-APACHE"]) {
		await writeFile(join(OUT, licence), await fetchText(licence, commit));
	}
	const counts = `${Object.keys(data.logicTypes).length} logic types, ${Object.keys(data.slotLogicTypes).length} slot logic types`;
	console.log(`ic10emu ${commit.slice(0, 7)}: ${counts} → ${OUT}`);
}

if (import.meta.main) await main(process.argv[2]);
