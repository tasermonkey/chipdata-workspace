/** Where the catalogue tools find the game, and where they keep their data. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
/** Mods' devices from the Stationpedia export; committed. */
export const MODS_FILE = join(DATA_DIR, "mods", "prefabs.json");

const DEFAULT_GAME_DIRS = [
	"C:/Program Files (x86)/Steam/steamapps/common/Stationeers",
	`${process.env.HOME}/.steam/steam/steamapps/common/Stationeers`,
];

/** The game's install folder: STATIONEERS_DIR, or the first default Steam path that exists. */
export function gameDir(): string | undefined {
	if (process.env.STATIONEERS_DIR) return existsSync(process.env.STATIONEERS_DIR) ? process.env.STATIONEERS_DIR : undefined;
	return DEFAULT_GAME_DIRS.find((dir) => existsSync(dir));
}

/** The game's Language/english.xml, if the game is installed. */
export function englishXmlPath(): string | undefined {
	const dir = gameDir();
	const path = dir && join(dir, "rocketstation_Data/StreamingAssets/Language/english.xml");
	return path && existsSync(path) ? path : undefined;
}

/** The Stationpedia export's folder (<game>/Stationpedia), if it exists. */
export function stationpediaDir(): string | undefined {
	const dir = gameDir();
	const path = dir && join(dir, "Stationpedia");
	return path && existsSync(path) ? path : undefined;
}
