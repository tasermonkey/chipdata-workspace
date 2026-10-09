import { formatSeconds } from "./time.ts";
import type { ChipState, Scheduler, TraceEntry } from "./scheduler.ts";

/** How many trace lines a report shows. */
const REPORT_LINES = 20;

/** A one-line description of where a chip is. */
export function describeChip(chip: ChipState, scheduler: Scheduler): string {
	const yields = chip.autoYields === 1 ? "1 auto-yield" : `${chip.autoYields} auto-yields`;
	if (chip.halt) {
		const text = chip.engine.lineText(chip.halt.line)?.trim() ?? "";
		return `halted at line ${chip.halt.line} (${JSON.stringify(text)}) in tick ${chip.halt.tick}: ${chip.halt.error.message}`;
	}
	if (chip.ended) return `ended (ran off the end of the program), ${yields}`;
	const line = chip.engine.nextLine;
	const at = `at line ${line} (${JSON.stringify(chip.engine.lineText(line)?.trim() ?? "")})`;
	if (chip.sleepUntil !== null) {
		return `sleeping until ${formatSeconds(chip.sleepUntil)} (now ${formatSeconds(scheduler.time)}), ${at}, ${yields}`;
	}
	return `${at}, ${yields}`;
}

/** The state of every chip and the last lines executed, for failure messages. */
export function formatReport(scheduler: Scheduler): string {
	const width = Math.max(...scheduler.chips.map((c) => c.key.length), 4);
	const out = [`  at tick ${scheduler.tick} (${formatSeconds(scheduler.time)} of game time)`, "chips:"];
	for (const chip of scheduler.chips) {
		out.push(`  ${chip.key.padEnd(width)}  ${describeChip(chip, scheduler)}  [${chip.source}]`);
	}
	const trace = scheduler.trace.slice(-REPORT_LINES);
	if (trace.length > 0) {
		out.push(`last ${trace.length} lines run:`);
		out.push(...formatTrace(trace, width));
	}
	return out.join("\n");
}

/** Trace entries as indented lines: tick, chip (when `chipWidth` is given), line index, source, outcome. */
export function formatTrace(trace: readonly TraceEntry[], chipWidth?: number): string[] {
	return trace.map((entry) => {
		const outcome = entry.outcome === "ran" ? "" : `  <- ${entry.outcome}`;
		const tick = `tick ${entry.tick}`.padEnd(10);
		const chip = chipWidth === undefined ? "" : `${entry.chip.padEnd(chipWidth)} `;
		return `  ${tick} ${chip}${String(entry.line).padStart(4)}  ${entry.text.trim()}${outcome}`;
	});
}

/** A run call couldn't do what it was asked; the message includes a report of every chip. */
export class SimRunError extends Error {
	override name = "SimRunError";
	constructor(reason: string, scheduler: Scheduler) {
		super(`${reason}\n${formatReport(scheduler)}`);
	}
}

/** A run went over its budget (`maxTicks` or `maxLinesPerRun`): the test equivalent of a timeout. */
export class SimBudgetError extends SimRunError {
	override name = "SimBudgetError";
}

/** A chip halted while the world was built with `failOnHalt`. */
export class SimHaltError extends Error {
	override name = "SimHaltError";
	constructor(chip: ChipState, scheduler: Scheduler) {
		super(`"${chip.key}" ${describeChip(chip, scheduler)} (failOnHalt)\n${formatReport(scheduler)}`);
	}
}
