/**
 * Which scenario a file stands for, for F5 and the "Debug IC10 Scenario" button:
 * - a world module, `x.world.ts` (or `.js`, `.mts`, `.mjs`, …): itself;
 * - env JSON (a `.json` file with `chips` and `devices`): itself, with `x.ic10` beside it (for
 *   `x.json` or `x.env.json`) as its program if there is one;
 * - an IC10 script, `x.ic10`: the world module `x.world.ts` beside it, or failing that the env
 *   JSON `x.env.json` or `x.json` with this script as its program.
 *
 * Pure apart from reading the file system, so it's tested without VS Code.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ScenarioLaunch {
	scenario: string;
	program?: string;
}

const WORLD_MODULE = /\.world\.[cm]?[jt]s$/i;
const WORLD_EXTENSIONS = [".world.ts", ".world.mts", ".world.js", ".world.mjs"];
const ENV_EXTENSIONS = [".env.json", ".json"];

/** The scenario `path` stands for, if any. `text` is the file's contents, if already at hand. */
export function scenarioFor(path: string, text?: string): ScenarioLaunch | undefined {
	if (WORLD_MODULE.test(path)) return { scenario: path };
	const lower = path.toLowerCase();
	if (lower.endsWith(".json")) {
		if (!isEnvJson(text ?? read(path))) return undefined;
		const stem = join(dirname(path), basename(path).replace(/(\.env)?\.json$/i, ""));
		const program = `${stem}.ic10`;
		return { scenario: path, ...(existsSync(program) && { program }) };
	}
	if (lower.endsWith(".ic10")) {
		const stem = path.slice(0, -".ic10".length);
		const world = WORLD_EXTENSIONS.map((e) => stem + e).find((p) => existsSync(p));
		if (world) return { scenario: world };
		const env = ENV_EXTENSIONS.map((e) => stem + e).find((p) => existsSync(p) && isEnvJson(read(p)));
		if (env) return { scenario: env, program: path };
	}
	return undefined;
}

/** Env JSON, as `World.fromEnv` takes it: an object with `chips` and `devices` lists. */
export function isEnvJson(text: string | undefined): boolean {
	if (text === undefined) return false;
	try {
		const value = JSON.parse(text) as { chips?: unknown; devices?: unknown };
		return Array.isArray(value.chips) && Array.isArray(value.devices);
	} catch {
		return false;
	}
}

function read(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
