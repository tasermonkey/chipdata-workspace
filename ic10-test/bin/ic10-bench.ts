#!/usr/bin/env node
/**
 * The ic10-bench command line, run in a project's folder (or with --project, or IC10_BENCH_ROOT):
 *
 *   ic10-bench catalog                     build the project's catalogue and ic10-bench-env.d.ts
 *   ic10-bench import-mods [<folder>]      read mods' devices from the Stationpedia export into ic10-mods/
 *   ic10-bench props <prefab | part of a name | hash>
 *   ic10-bench logic <logic type | part of one>
 *
 * Lookups read the project's catalogue, or the packaged one if `catalog` hasn't been run.
 */
import { resolve } from "node:path";
import { loadCatalog } from "../src/catalog/catalog.ts";
import { buildProjectCatalog } from "../src/cli/catalog.ts";
import { importMods, NoExportError } from "../src/cli/import-mods.ts";
import { describeLogic, describePrefab, findLogicTypes, findPrefabs, listPrefabs } from "../src/cli/lookup.ts";
import { ROOT_ENV } from "../src/project.ts";

const USAGE = `Usage:
  ic10-bench catalog                                  build this project's device catalogue and prefab types
  ic10-bench import-mods [<Stationpedia folder>]      read your mods' devices from the Stationpedia export
  ic10-bench props <prefab | part of a name | hash>   a prefab's logic types, modes and slots
  ic10-bench logic <logic type | part of one>          what a logic type is, and which prefabs have it

Options:
  --project <folder>   the project's folder (default: the current one)`;

function props(query: string): void {
	const catalog = loadCatalog();
	const found = findPrefabs(catalog, query);
	if (found.length === 1) console.log(describePrefab(catalog, found[0]!));
	else if (found.length === 0) {
		console.log(`No prefab matches "${query}".`);
		process.exitCode = 1;
	} else console.log(`${found.length} prefabs match "${query}":\n${listPrefabs(found)}`);
}

function logic(query: string): void {
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

// process.exitCode rather than process.exit(): exiting while output is still being written
// crashes Node on Windows.
const args = process.argv.slice(2);
const projectFlag = args.indexOf("--project");
if (projectFlag >= 0) {
	const [, folder] = args.splice(projectFlag, 2);
	if (folder) process.env[ROOT_ENV] = resolve(folder);
}
const [command, ...rest] = args;
const query = rest.join(" ");
try {
	if (command === "catalog") console.log((await buildProjectCatalog()).join("\n"));
	else if (command === "import-mods") console.log((await importMods(rest[0])).join("\n"));
	else if (command === "props" && query) props(query);
	else if (command === "logic" && query) logic(query);
	else {
		console.log(USAGE);
		process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
	}
} catch (error) {
	if (!(error instanceof NoExportError)) throw error;
	console.error(error.message);
	process.exitCode = 1;
}
