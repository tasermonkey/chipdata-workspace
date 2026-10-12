#!/usr/bin/env node
/**
 * Run a world without a test, for the VS Code debugger's scenario launch:
 *
 *   node --conditions=source run-scenario.ts <scenario> [--program <file.ic10>] [--chip <key>]
 *
 * The scenario is a world module (`export default () => sim(…)….build()`; it can add events and
 * models before returning the world) or env JSON (`World.fromEnv`). With `--program`, a chip of an
 * env world runs that file instead of its `code`: the one named by `--chip`, or the only one.
 *
 * With `IC10_DEBUG` set it connects to the debugger first, so its chips can be stepped through.
 * It runs ticks as fast as it can until nothing can change any more (every chip has halted or
 * ended, and no events are due), or until the debugger goes away.
 */
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { World } from "../world/world.ts";
import { attachDebugger } from "./attach.ts";

export interface ScenarioOptions {
	/** For env JSON: the `.ic10` file a chip runs instead of its `code`. */
	program?: string;
	/** The housing whose chip runs `program`. Default: the only one. */
	chip?: string;
}

/** Build the world a scenario file describes. */
export async function loadScenario(file: string, options: ScenarioOptions = {}): Promise<World> {
	const path = resolve(file);
	if (extname(path).toLowerCase() === ".json") return envScenario(path, options);
	if (options.program !== undefined) throw new Error("--program is for env JSON; a world module names its chips' files");
	const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
	if (typeof module.default !== "function") {
		throw new Error(`${file}: expected a default export, a function that builds and returns the world`);
	}
	const world: unknown = await (module.default as () => unknown)();
	if (!(world instanceof World)) throw new Error(`${file}: its default export didn't return a World (forgot .build()?)`);
	return world;
}

async function envScenario(path: string, { program, chip }: ScenarioOptions): Promise<World> {
	if (program === undefined) return World.fromEnv(path);
	let key = chip;
	if (key === undefined) {
		// Build it once without the debugger to find its chips' keys.
		const chips = (await World.fromEnv(path, { debug: false })).listChips().map((c) => c.key);
		if (chips.length !== 1) throw new Error(`${path} has ${chips.length} chips (${chips.join(", ")}); say which runs the program`);
		key = chips[0]!;
	}
	return World.fromEnv(path, { programs: { [key]: resolve(program) } });
}

/** Run until nothing can change; says why it stopped. */
export async function runScenario(world: World): Promise<string> {
	while (!world.idle()) await world.runTicks(1);
	return `every chip has stopped and no events are due (tick ${world.tick})`;
}

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: { program: { type: "string" }, chip: { type: "string" } },
	});
	if (positionals.length !== 1) throw new Error("usage: run-scenario <world module or env JSON> [--program <file.ic10>] [--chip <key>]");

	const address = process.env.IC10_DEBUG;
	const attached = address ? await attachDebugger(address) : undefined;
	// Stop pressed: the debugger has gone, so there's nothing to run for.
	void attached?.closed.then(() => process.exit());
	try {
		const world = await loadScenario(positionals[0]!, values);
		console.log(`ic10-bench: ${await runScenario(world)}`);
	} catch (error) {
		console.error(error instanceof Error ? (error.stack ?? error.message) : error);
		process.exitCode = 1;
	} finally {
		await attached?.close();
	}
}

if (import.meta.main) await main();
