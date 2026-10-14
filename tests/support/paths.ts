/** Paths specific to this repo. Generic helpers live in @tasermonkey/ic10-bench. */
import { resolve } from "node:path";
import { readScript } from "@tasermonkey/ic10-bench";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Read a script by its repo-relative path, e.g. "ic10/ClimateControl/x.ic10". */
export function readRepoScript(path: string): string {
	return readScript(resolve(REPO_ROOT, path));
}
