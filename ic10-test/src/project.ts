/**
 * Where a project keeps its ic10-bench files. The project is the folder in IC10_BENCH_ROOT, which
 * `defineIc10Config` sets, or else the working directory.
 *
 *   ic10-mods/<machine>.json   mods' devices, one file per machine (`ic10-bench import-mods`); commit these
 *   .ic10-bench/               the catalogue with the game's descriptions, and this machine's id; git-ignore it
 *   ic10-bench-env.d.ts        the project's prefab types (`ic10-bench catalog`); git-ignore it, it holds game text
 */
import { join, resolve } from "node:path";

export const ROOT_ENV = "IC10_BENCH_ROOT";

export interface ProjectPaths {
	root: string;
	/** Mods' devices, one committed file per machine. */
	mods: string;
	/** Git-ignored files this machine builds. */
	local: string;
	/** The catalogue `ic10-bench catalog` builds: the game's prefabs and descriptions, plus the mods. */
	catalog: string;
	/** This machine's id, which names its file in `mods`. */
	machine: string;
	/** The prefab types `ic10-bench catalog` writes for TypeScript. */
	envTypes: string;
}

export function projectRoot(): string {
	return resolve(process.env[ROOT_ENV] || process.cwd());
}

export function projectPaths(root: string = projectRoot()): ProjectPaths {
	const local = join(root, ".ic10-bench");
	return {
		root,
		mods: join(root, "ic10-mods"),
		local,
		catalog: join(local, "catalog.json"),
		machine: join(local, "machine.json"),
		envTypes: join(root, "ic10-bench-env.d.ts"),
	};
}
