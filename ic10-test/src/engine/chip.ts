import {
	type Chip,
	ErrorSeverity,
	type Housing,
	type Ic10Error,
	type Ic10Runner,
	InstructionLine,
	LabelLine,
} from "@stationeers-ic/ic10";

/** What happened when a chip executed one line. */
export type StepOutcome =
	/** The line ran and the chip carries on. */
	| { kind: "ran"; line: number }
	/** The line was a `yield` (or `sleep 0`): the chip is done for this tick. */
	| { kind: "yield"; line: number }
	/** The line was `sleep n` with n > 0: the chip is parked for `seconds` of game time. */
	| { kind: "sleep"; line: number; seconds: number }
	/** The chip ran off the end of its program and stopped, without an error. */
	| { kind: "end" }
	/** The chip halted on an error, as it would in game. */
	| { kind: "halt"; line: number; error: Ic10Error };

const HALTING = new Set<string>([ErrorSeverity.Strong, ErrorSeverity.Critical]);

/**
 * One chip in its housing, as the harness sees it. This (with the rest of `engine/`) is the only
 * code that touches the emulator's internals.
 */
export class EngineChip {
	readonly runner: Ic10Runner;
	readonly housing: Housing;

	constructor(runner: Ic10Runner, housing: Housing) {
		this.runner = runner;
		this.housing = housing;
	}

	private get chip(): Chip {
		const chip = this.housing.chip;
		if (!chip) throw new Error(`housing ${this.housing.id} has no chip`);
		return chip;
	}

	/** Number of source lines, including blank, comment and label lines. */
	get lineCount(): number {
		return this.runner.lines.length;
	}

	/** Index of the line the chip executes next. */
	get nextLine(): number {
		return this.runner.context.getNextLineIndex();
	}

	get stopped(): boolean {
		return this.runner.isStopped();
	}

	/** Source text of a line (as written, without the newline), or undefined past the end. */
	lineText(index: number): string | undefined {
		return this.runner.lines[index]?.originalText;
	}

	/** Whether a line is an instruction, as opposed to a blank, comment or label line. */
	isInstruction(index: number): boolean {
		return this.runner.lines[index] instanceof InstructionLine;
	}

	/** Line index of a label, or undefined if there's no such label. */
	findLabel(name: string): number | undefined {
		return this.runner.lines.find((line) => line instanceof LabelLine && line.label === name)?.position;
	}

	get registerCount(): number {
		return this.chip.register_length;
	}

	register(index: number): number {
		return this.chip.registers.get(index) ?? 0;
	}

	setRegister(index: number, value: number): void {
		if (!Number.isInteger(index) || index < 0 || index >= this.registerCount) {
			throw new Error(`no register r${index}`);
		}
		this.chip.registers.set(index, value);
	}

	/** Resolve `r15`, `sp`, `ra` or an alias (as defined so far by the script) to a register index. */
	resolveRegister(name: string): number | undefined {
		let current = name;
		for (let hops = 0; hops < 16; hops++) {
			const match = /^r(\d+)$/.exec(current);
			if (match) {
				const index = Number(match[1]);
				return index < this.registerCount ? index : undefined;
			}
			const define = this.chip.defines.get(current);
			if (define?.type !== "alias") return undefined;
			current = String(define.value);
		}
		return undefined;
	}

	/** Aliases the script has defined so far, by register index (`sp` and `ra` included). */
	aliases(): Map<number, string[]> {
		const out = new Map<number, string[]>();
		for (const [name, define] of this.chip.defines) {
			if (define.type !== "alias") continue;
			const index = this.resolveRegister(name);
			if (index === undefined) continue;
			out.set(index, [...(out.get(index) ?? []), name]);
		}
		return out;
	}

	get stackPointerRegister(): number {
		return this.chip.SP;
	}

	get returnAddressRegister(): number {
		return this.chip.RA;
	}

	/** The stack's contents, with trailing zeros trimmed. */
	stack(): number[] {
		return this.chip.memory.toArray();
	}

	stackAt(index: number): number {
		return this.chip.memory.get(index) ?? 0;
	}

	/** Every error recorded on the chip so far, of any severity. */
	get errors(): Ic10Error[] {
		return this.runner.context.errors;
	}

	/**
	 * Execute one line. Strong and critical errors halt the chip, as in game: it stops, and the
	 * housing's `Error` is set to 1. The emulator itself only stops on critical errors.
	 */
	async step(): Promise<StepOutcome> {
		const line = this.nextLine;
		const errorsBefore = this.errors.length;
		const ok = await this.runner.step();

		const critical = this.runner.context.criticalError;
		if (critical) return this.halted(critical, line);
		const halting = this.errors.slice(errorsBefore).find((error) => HALTING.has(error.severity));
		if (halting) {
			this.runner.stopExecution();
			return this.halted(halting, line);
		}
		if (!ok) return { kind: "end" };

		const suspend = this.runner.suspend;
		if (suspend?.kind === "yield") return { kind: "yield", line };
		if (suspend?.kind === "sleep") return { kind: "sleep", line, seconds: suspend.seconds };
		return { kind: "ran", line };
	}

	private halted(error: Ic10Error, line: number): StepOutcome {
		try {
			this.housing.props?.forceWrite("Error", 1);
		} catch {
			// a housing without an Error property
		}
		return { kind: "halt", line: error.line ?? line, error };
	}
}
