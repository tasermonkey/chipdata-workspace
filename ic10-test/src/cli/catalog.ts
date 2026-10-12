/**
 * `ic10-bench catalog`: builds the project's catalogue and prefab types (plan §6).
 *
 * Prefabs: the emulator's game data, plus the project's mods (ic10-mods/). Descriptions: a local
 * Stationpedia export (<game>/Stationpedia/Enums.json), then the game's Language/english.xml; the
 * game is found through STATIONEERS_DIR or Steam. Without either there are no descriptions;
 * everything else is the same.
 *
 * Writes .ic10-bench/catalog.json and ic10-bench-env.d.ts in the project.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { DEVICES } from "@tasermonkey/ic10";
import { buildCatalog, type DescriptionSource, parseEnglishXml } from "../catalog/build.ts";
import { englishXmlPath, stationpediaDir } from "../catalog/game-paths.ts";
import { modPrefabs } from "../catalog/mods.ts";
import { type StationpediaEnums, stationpediaDescriptions } from "../catalog/stationpedia.ts";
import { projectTypesSource } from "../catalog/types.ts";
import { projectPaths } from "../project.ts";

/** The game's descriptions: the Stationpedia export's, then english.xml's (empty without the game). */
export function gameDescriptions(): DescriptionSource[] {
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
	return descriptions;
}

/** Builds the project's catalogue and types; returns what to print. */
export async function buildProjectCatalog(root?: string): Promise<string[]> {
	const paths = projectPaths(root);
	const descriptions = gameDescriptions();
	const { catalog, undescribed } = buildCatalog({
		devices: Object.values(DEVICES),
		modPrefabs: [...modPrefabs(paths.root).values()],
		descriptions,
	});

	await mkdir(dirname(paths.catalog), { recursive: true });
	await writeFile(paths.catalog, `${JSON.stringify(catalog)}\n`);
	await writeFile(paths.envTypes, projectTypesSource(catalog));

	const prefabs = Object.values(catalog.prefabs);
	const mods = prefabs.filter((p) => p.source === "mod").length;
	const lines = [
		`catalog: ${prefabs.length} prefabs (${mods} from mods), ${Object.keys(catalog.logicTypes).length} logic types; ` +
			`descriptions from ${catalog.sources.descriptions}`,
		`catalog: wrote ${relative(paths.root, paths.catalog)} and ${relative(paths.root, paths.envTypes)}`,
	];
	if (descriptions.length === 0) {
		lines.push("catalog: no descriptions: install the game, or set STATIONEERS_DIR to its folder, and run this again");
		return lines;
	}
	for (const [kind, names] of Object.entries(undescribed)) {
		if (!names.length) continue;
		const shown = names.slice(0, 8).join(", ") + (names.length > 8 ? `, and ${names.length - 8} more` : "");
		lines.push(`catalog: ${names.length} ${kind} have no description: ${shown}`);
	}
	return lines;
}
