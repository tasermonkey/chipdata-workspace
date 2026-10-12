/** Where the catalogue tools find the game, and where they keep their data. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export { MODS_PATH as MODS_FILE } from "../src/catalog/mods.ts";

const STATIONEERS_APP_ID = "544550";

const DEFAULT_GAME_DIRS = [
	"C:/Program Files (x86)/Steam/steamapps/common/Stationeers",
	`${process.env.HOME}/.steam/steam/steamapps/common/Stationeers`,
];

/** Steam's own install folder: the Windows registry, else the usual Linux/macOS spots. */
function steamRoots(): string[] {
	const roots: string[] = [];
	if (process.platform === "win32") {
		try {
			const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
			const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
			if (match) roots.push(match[1].trim());
		} catch {
			// Steam isn't registered; fall through to the defaults.
		}
	} else {
		roots.push(`${process.env.HOME}/.steam/steam`, `${process.env.HOME}/.local/share/Steam`, `${process.env.HOME}/Library/Application Support/Steam`);
	}
	return roots.filter((root) => existsSync(root));
}

/** Every Steam library folder (the Steam root plus those listed in libraryfolders.vdf). */
function steamLibraries(): string[] {
	const libraries = new Set<string>();
	for (const root of steamRoots()) {
		libraries.add(root);
		try {
			const vdf = readFileSync(join(root, "steamapps/libraryfolders.vdf"), "utf8");
			for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(match[1].replaceAll("\\\\", "/"));
		} catch {
			// No library list; the root alone is still checked.
		}
	}
	return [...libraries];
}

/** Ask Steam where Stationeers is installed: the library holding its app manifest, then that manifest's installdir. */
function steamGameDir(): string | undefined {
	for (const library of steamLibraries()) {
		try {
			const manifest = readFileSync(join(library, `steamapps/appmanifest_${STATIONEERS_APP_ID}.acf`), "utf8");
			const installDir = /"installdir"\s+"([^"]+)"/.exec(manifest)?.[1];
			const dir = installDir && join(library, "steamapps/common", installDir);
			if (dir && existsSync(dir)) return dir;
		} catch {
			// Not installed in this library.
		}
	}
	return undefined;
}

/** The game's install folder: STATIONEERS_DIR, else wherever Steam says it is, else the first default path that exists. */
export function gameDir(): string | undefined {
	if (process.env.STATIONEERS_DIR) return existsSync(process.env.STATIONEERS_DIR) ? process.env.STATIONEERS_DIR : undefined;
	return steamGameDir() ?? DEFAULT_GAME_DIRS.find((dir) => existsSync(dir));
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
