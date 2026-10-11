/**
 * Builds the device catalogue into ic10-test/generated/ (plan §6): catalog.json, and
 * prefab-props.ts, the property types `sim().device()` is checked against.
 *
 *   npm run catalog:build      (node --conditions=source ic10-test/tools/catalog-build.ts)
 *
 * Prefabs: the emulator's game data, plus mods' devices from data/mods/prefabs.json.
 * Descriptions: a local Stationpedia export (<game>/Stationpedia/Enums.json), then the game's
 * Language/english.xml; the game is found through STATIONEERS_DIR or the default Steam path.
 * Without either there are no descriptions; everything else is the same.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEVICES } from "@stationeers-ic/ic10";
import { buildCatalog, type DescriptionSource, parseEnglishXml } from "../src/catalog/build.ts";
import { CATALOG_PATH, GENERATED_DIR } from "../src/catalog/catalog.ts";
import { modPrefabs } from "../src/catalog/mods.ts";
import { type StationpediaEnums, stationpediaDescriptions } from "../src/catalog/stationpedia.ts";
import { prefabPropsSource } from "../src/catalog/types.ts";
import { englishXmlPath, stationpediaDir } from "./game-paths.ts";

const descriptions: DescriptionSource[] = [];
const exportDir = stationpediaDir();
if (exportDir && existsSync(join(exportDir, "Enums.json"))) {
	const enums = JSON.parse(readFileSync(join(exportDir, "Enums.json"), "utf8")) as StationpediaEnums;
	const date = statSync(join(exportDir, "Enums.json")).mtime.toISOString().slice(0, 10);
	descriptions.push({ source: "stationpedia", label: `Stationpedia export (${date})`, data: stationpediaDescriptions(enums) });
}
const xmlPath = englishXmlPath();
if (xmlPath) {
	const date = statSync(xmlPath).mtime.toISOString().slice(0, 10);
	descriptions.push({ source: "game", label: `game english.xml (${date})`, data: parseEnglishXml(readFileSync(xmlPath, "utf8")) });
}

const { catalog, undescribed } = buildCatalog({
	devices: Object.values(DEVICES),
	modPrefabs: [...modPrefabs().values()],
	descriptions,
});

await mkdir(GENERATED_DIR, { recursive: true });
await writeFile(CATALOG_PATH, `${JSON.stringify(catalog)}\n`);
await writeFile(join(GENERATED_DIR, "prefab-props.ts"), prefabPropsSource(catalog));

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
