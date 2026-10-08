/** Paths specific to this repo. Generic helpers live in @tasermonkey/ic10-test. */
import { join, relative, resolve } from "node:path";
import { findScripts, readScript } from "@tasermonkey/ic10-test";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const SCRIPTS_ROOT = join(REPO_ROOT, "ic10");

/** Read a script by its repo-relative path, e.g. "ic10/ClimateControl/x.ic10". */
export function readRepoScript(path: string): string {
	return readScript(resolve(REPO_ROOT, path));
}

/** Every script under ic10/, as repo-relative forward-slash paths. */
export function repoScripts(): string[] {
	return findScripts(SCRIPTS_ROOT).map((p) => relative(REPO_ROOT, p).replaceAll("\\", "/"));
}
