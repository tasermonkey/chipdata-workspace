import type { Ic10Error } from "@stationeers-ic/ic10";
import type { DebugGate } from "../debug/gate.ts";
import type { EngineChip, StepOutcome } from "../engine/chip.ts";
import type { World } from "../world/world.ts";
import { SimBudgetError, SimHaltError } from "./errors.ts";

export interface SchedulerOptions {
	/** Game time per tick, in seconds. */
	tickSeconds: number;
	/** Most lines (all chips together) one run call may execute before it fails. */
	maxLinesPerRun: number;
	/** Throw as soon as any chip halts. */
	failOnHalt: boolean;
	/** How many executed lines to keep for failure reports. */
	traceLength: number;
}

/** Why and where a chip halted. */
export interface Halt {
	/** Index of the line that failed (0-based, like the game's `LineNumber`). */
	line: number;
	error: Ic10Error;
	/** Tick in which it halted. */
	tick: number;
}

/** One automatic yield: the tick it happened in, and the last line run before it. */
export interface AutoYield {
	tick: number;
	line: number;
}

/** One executed line, for failure reports. */
export interface TraceEntry {
	tick: number;
	chip: string;
	line: number;
	text: string;
	outcome: StepOutcome["kind"];
}

/** The scheduler's view of one chip. */
export class ChipState {
	/** Lines used toward this tick's limit. */
	linesThisTick = 0;
	doneThisTick = false;
	/** Game time (seconds) the chip sleeps until, or null. */
	sleepUntil: number | null = null;
	halt: Halt | null = null;
	/** Ran off the end of its program. */
	ended = false;
	/** Every time the chip used up its lines for a tick and was preempted, in order. */
	readonly autoYieldLog: AutoYield[] = [];
	/** Lines executed in total. */
	linesExecuted = 0;

	/** Test-side key of the housing. */
	readonly key: string;
	readonly engine: EngineChip;
	/** Where the program came from: a file path, `<code>` for inline source, or `<env>`. */
	readonly source: string;
	/** Lines per tick before an automatic yield (the game's is 128). */
	readonly linesPerTick: number;
	/** Whether blank, comment and label lines use up the per-tick budget (they do in game). */
	readonly countNonInstructionLines: boolean;
	/** Which device (by key) is on each pin, e.g. `{ d0: "vent" }`. */
	readonly pins: Readonly<Record<string, string>>;

	constructor(
		key: string,
		engine: EngineChip,
		source: string,
		linesPerTick: number,
		countNonInstructionLines: boolean,
		pins: Record<string, string> = {},
	) {
		this.key = key;
		this.engine = engine;
		this.source = source;
		this.linesPerTick = linesPerTick;
		this.countNonInstructionLines = countNonInstructionLines;
		this.pins = pins;
	}

	/** Times the chip used up its lines for a tick and was preempted. */
	get autoYields(): number {
		return this.autoYieldLog.length;
	}

	/** Halted or ended: the chip won't run again. */
	get stopped(): boolean {
		return this.halt !== null || this.ended;
	}

	/** Whether the chip can run a line now, in the tick in progress. */
	get runnable(): boolean {
		return !this.stopped && !this.doneThisTick && this.sleepUntil === null;
	}
}

export interface SchedulerHooks {
	world: World;
	gate?: DebugGate;
	/** Runs before any chip in a tick: scripted events. */
	beginTick(tick: number): Promise<void>;
	/** Runs after every chip in a tick: recordings. `tick` is the number of ticks completed. */
	endTick(tick: number): Promise<void>;
}

/** What one `advance()` did. */
export type Advance = "line" | "tick" | "stopped";

const EPSILON = 1e-9;

/**
 * Runs chips under the game's rules. Each tick, every chip in turn runs until it yields, sleeps,
 * halts, ends, or uses up its lines for the tick (an automatic yield). Sleeping chips are skipped
 * until game time reaches their wake time. Work is done one line per `advance()`, so a run can
 * stop in the middle of a tick and the next one carries on from there.
 */
export class Scheduler {
	/** Ticks completed. */
	tick = 0;
	private inTick = false;
	private cursor = 0;
	/** Lines executed since the current run call started (for `maxLinesPerRun`). */
	linesThisRun = 0;
	readonly trace: TraceEntry[] = [];

	readonly chips: ChipState[];
	readonly options: SchedulerOptions;
	private readonly hooks: SchedulerHooks;

	constructor(chips: ChipState[], options: SchedulerOptions, hooks: SchedulerHooks) {
		this.chips = chips;
		this.options = options;
		this.hooks = hooks;
	}

	/** Game time at the start of the tick in progress (or the next one), in seconds. */
	get time(): number {
		return this.tick * this.options.tickSeconds;
	}

	/** Whether a tick has started and not finished (a run stopped in the middle of it). */
	get tickInProgress(): boolean {
		return this.inTick;
	}

	/**
	 * Run one line of the next chip due, or finish the tick if every chip is done with it.
	 * `stopBefore` is asked before each line; if it says so, nothing runs and "stopped" is returned.
	 */
	async advance(stopBefore?: (chip: ChipState, line: number) => boolean): Promise<Advance> {
		if (!this.inTick) await this.beginTick();

		while (this.cursor < this.chips.length) {
			const chip = this.chips[this.cursor]!;
			if (!chip.runnable) {
				this.cursor++;
				continue;
			}
			if (stopBefore?.(chip, chip.engine.nextLine)) return "stopped";
			await this.stepChip(chip, true);
			return "line";
		}

		this.tick++;
		this.inTick = false;
		await this.hooks.endTick(this.tick);
		await this.hooks.gate?.onTick?.({ world: this.hooks.world, tick: this.tick });
		return "tick";
	}

	private async beginTick(): Promise<void> {
		await this.hooks.beginTick(this.tick);
		this.inTick = true;
		this.cursor = 0;
		for (const chip of this.chips) {
			chip.linesThisTick = 0;
			chip.doneThisTick = false;
			if (chip.sleepUntil !== null && this.time + EPSILON >= chip.sleepUntil) chip.sleepUntil = null;
		}
	}

	/**
	 * Execute one line of a chip. With `ticks`, apply the tick rules (yield, sleep and the per-tick
	 * line limit end the chip's tick); without, just run the line.
	 */
	async stepChip(chip: ChipState, ticks: boolean): Promise<StepOutcome> {
		const line = chip.engine.nextLine;
		const text = chip.engine.lineText(line) ?? "";
		const gate = this.hooks.gate;
		const info = { world: this.hooks.world, chip: chip.key, line, text, tick: this.tick };
		await gate?.beforeLine?.(info);

		const counts = chip.countNonInstructionLines || chip.engine.isInstruction(line);
		const outcome = await chip.engine.step();
		if (outcome.kind !== "end") {
			chip.linesExecuted++;
			this.linesThisRun++;
			this.trace.push({ tick: this.tick, chip: chip.key, line, text, outcome: outcome.kind });
			if (this.trace.length > this.options.traceLength) this.trace.shift();
		}

		switch (outcome.kind) {
			case "halt":
				chip.halt = { line: outcome.line, error: outcome.error, tick: this.tick };
				await gate?.onHalt?.({ ...info, line: outcome.line, error: outcome.error });
				if (this.options.failOnHalt) throw new SimHaltError(chip, this);
				break;
			case "end":
				chip.ended = true;
				break;
			case "yield":
				if (ticks) chip.doneThisTick = true;
				break;
			case "sleep":
				if (ticks) {
					chip.sleepUntil = this.time + outcome.seconds;
					chip.doneThisTick = true;
				}
				break;
			case "ran":
				break;
		}

		if (ticks && counts) chip.linesThisTick++;
		if (ticks && !chip.doneThisTick && !chip.stopped && chip.linesThisTick >= chip.linesPerTick) {
			chip.autoYieldLog.push({ tick: this.tick, line });
			chip.doneThisTick = true;
			await gate?.onAutoYield?.(info);
		}

		if (this.linesThisRun > this.options.maxLinesPerRun) {
			throw new SimBudgetError(
				`ran more than ${this.options.maxLinesPerRun} lines in one call (maxLinesPerRun)`,
				this,
			);
		}
		return outcome;
	}
}
