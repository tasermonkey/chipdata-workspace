import type { Ic10Error } from "@stationeers-ic/ic10";
import type { World } from "../world/world.ts";

/** Where a chip is when the scheduler consults the gate. */
export interface DebugLineInfo {
	world: World;
	/** Test-side key of the chip's housing. */
	chip: string;
	/** Index of the line about to run (or that just ran, for `onHalt` / `onAutoYield`). */
	line: number;
	/** Source text of that line. */
	text: string;
	/** Tick in progress. */
	tick: number;
}

/**
 * Hooks the scheduler awaits as it runs, so a debugger can pause a test's chips line by line.
 * Every hook is optional, and with no gate the scheduler doesn't pause at all.
 */
export interface DebugGate {
	/** Called before every line. Pausing is just not resolving until the user continues. */
	beforeLine?(info: DebugLineInfo): void | Promise<void>;
	/** A chip halted on an error. */
	onHalt?(info: DebugLineInfo & { error: Ic10Error }): void | Promise<void>;
	/** A chip used up its lines for the tick and was preempted. */
	onAutoYield?(info: DebugLineInfo): void | Promise<void>;
	/** A tick finished (`tick` is the number of ticks completed). */
	onTick?(info: { world: World; tick: number }): void | Promise<void>;
}

let defaultGate: DebugGate | undefined;

/**
 * Set the gate every world built afterwards uses, unless `sim({ debug })` names one. This is how a
 * debugger attaches to tests that know nothing about it.
 */
export function setDefaultDebugGate(gate: DebugGate | undefined): void {
	defaultGate = gate;
}

export function getDefaultDebugGate(): DebugGate | undefined {
	return defaultGate;
}
