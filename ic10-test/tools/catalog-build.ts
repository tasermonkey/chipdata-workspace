/**
 * Builds the device catalogue into ic10-test/generated/ (plan §6).
 *
 *   npm run catalog:build      (node --conditions=source ic10-test/tools/catalog-build.ts)
 *
 * Descriptions come from the game's Language/english.xml, found through STATIONEERS_DIR or the
 * default Steam path; without the game, from ic10emu's copy in data/ic10emu/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICES } from "@stationeers-ic/ic10";
import { buildCatalog, type Descriptions, parseEnglishXml } from "../src/catalog/build.ts";
import { CATALOG_PATH, type CatalogPrefab, GENERATED_DIR } from "../src/catalog/catalog.ts";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DEFAULT_GAME_DIRS = [
	"C:/Program Files (x86)/Steam/steamapps/common/Stationeers",
	`${process.env.HOME}/.steam/steam/steamapps/common/Stationeers`,
];
const ENGLISH_XML = "rocketstation_Data/StreamingAssets/Language/english.xml";

function findEnglishXml(): string | undefined {
	const dirs = process.env.STATIONEERS_DIR ? [process.env.STATIONEERS_DIR] : DEFAULT_GAME_DIRS;
	return dirs.map((dir) => join(dir, ENGLISH_XML)).find((path) => existsSync(path));
}

function fallbackDescriptions(): Descriptions {
	type Entries = Record<string, { description: string }>;
	const data = JSON.parse(readFileSync(join(DATA, "ic10emu", "descriptions.json"), "utf8")) as {
		logicTypes: Entries;
		slotLogicTypes: Entries;
	};
	const texts = (entries: Entries) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.description]));
	return { logicTypes: texts(data.logicTypes), slotLogicTypes: texts(data.slotLogicTypes) };
}

/** data/mods/*.json: each a list of mod prefabs. */
function modPrefabs(): CatalogPrefab[] {
	const dir = join(DATA, "mods");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { prefabs: CatalogPrefab[] }).prefabs);
}

const xmlPath = findEnglishXml();
const { catalog, undescribed } = buildCatalog({
	devices: Object.values(DEVICES),
	modPrefabs: modPrefabs(),
	game: xmlPath ? parseEnglishXml(readFileSync(xmlPath, "utf8")) : undefined,
	gameLabel: xmlPath && `game english.xml (${statSync(xmlPath).mtime.toISOString().slice(0, 10)})`,
	fallback: fallbackDescriptions(),
});

await mkdir(GENERATED_DIR, { recursive: true });
await writeFile(CATALOG_PATH, `${JSON.stringify(catalog)}\n`);

const prefabs = Object.values(catalog.prefabs);
const mods = prefabs.filter((p) => p.source === "mod").length;
console.log(
	`catalog: ${prefabs.length} prefabs (${mods} from mods), ${Object.keys(catalog.logicTypes).length} logic types; ` +
		`descriptions from ${catalog.sources.descriptions}`,
);
for (const [kind, names] of Object.entries(undescribed)) {
	if (!names.length) continue;
	const shown = names.slice(0, 8).join(", ") + (names.length > 8 ? `, and ${names.length - 8} more` : "");
	console.log(`catalog: ${names.length} ${kind} have no description: ${shown}`);
}
