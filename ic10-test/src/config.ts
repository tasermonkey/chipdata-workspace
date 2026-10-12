/**
 * `defineIc10Config`: Vitest's `defineConfig` with ic10-bench set up, for a project's
 * vitest.config.ts:
 *
 * ```ts
 * import { defineIc10Config } from "@tasermonkey/ic10-bench/config";
 * export default defineIc10Config();
 * ```
 *
 * It adds the IC10 matchers (`toHaveProps`, `toHaveRegister`, …) as a setup file, and tells the
 * harness where the project is (IC10_BENCH_ROOT), so it finds ic10-mods/ and the catalogue
 * `ic10-bench catalog` builds. Anything you pass is merged in, as with Vitest's `mergeConfig`.
 */
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type ViteUserConfig } from "vitest/config";
import { ROOT_ENV } from "./project.ts";

/** The matchers' setup file, beside this one (.ts in a checkout, .js once built). */
const SETUP_FILE = fileURLToPath(new URL(`./matchers/vitest-setup${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

export interface Ic10ConfigOptions {
	/** The project's folder, with its ic10-mods/ and .ic10-bench/. Default: the config's `root`, else the working directory. */
	project?: string;
}

export function defineIc10Config(config: ViteUserConfig = {}, options: Ic10ConfigOptions = {}): ViteUserConfig {
	const project = resolve(options.project ?? config.root ?? process.cwd());
	return mergeConfig({ test: { setupFiles: [SETUP_FILE], env: { [ROOT_ENV]: project } } }, config);
}
