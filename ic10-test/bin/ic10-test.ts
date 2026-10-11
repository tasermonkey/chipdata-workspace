#!/usr/bin/env node
/**
 * Device catalogue lookups:
 *
 *   ic10-test props <prefab | part of a name | hash>
 *   ic10-test logic <logic type | part of one>
 *
 * Reads ic10-test/generated/catalog.json, building it first if it's missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_PATH, loadCatalog } from "../src/catalog/catalog.ts";
import { describeLogic, describePrefab, findLogicTypes, findPrefabs, listPrefabs } from "../src/cli/lookup.ts";

const USAGE = `Usage:
  ic10-test props <prefab | part of a name | hash>   a prefab's logic types, modes and slots
  ic10-test logic <logic type | part of one>          what a logic type is, and which prefabs have it`;

/** Builds the catalogue if it's missing; false if that failed. */
function ensureCatalog(): boolean {
	if (existsSync(CATALOG_PATH)) return true;
	console.error("Building the device catalogue…");
	const build = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "catalog-build.ts");
	const result = spawnSync(process.execPath, ["--conditions=source", build], { stdio: ["ignore", "ignore", "inherit"] });
	return result.status === 0;
}

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
const [command, ...rest] = process.argv.slice(2);
const query = rest.join(" ");
if (!command || !query || !["props", "logic"].includes(command)) {
	console.log(USAGE);
	process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
} else if (!ensureCatalog()) {
	process.exitCode = 1;
} else if (command === "props") {
	const catalog = loadCatalog();
	const found = findPrefabs(catalog, query);
	if (found.length === 1) console.log(describePrefab(catalog, found[0]!));
	else if (found.length === 0) {
		console.log(`No prefab matches "${query}".`);
		process.exitCode = 1;
	} else console.log(`${found.length} prefabs match "${query}":\n${listPrefabs(found)}`);
} else {
	const catalog = loadCatalog();
	const exact = describeLogic(catalog, query);
	const found = exact ? [] : findLogicTypes(catalog, query);
	if (exact) console.log(exact);
	else if (found.length === 1) console.log(describeLogic(catalog, found[0]!));
	else if (found.length === 0) {
		console.log(`No logic type matches "${query}".`);
		process.exitCode = 1;
	} else console.log(`${found.length} logic types match "${query}":\n  ${found.join("\n  ")}`);
}
