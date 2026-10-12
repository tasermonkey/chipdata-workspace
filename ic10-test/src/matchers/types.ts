/**
 * The IC10 matchers' types, added to Vitest's `expect`. The package's entry exports `Ic10Matchers`,
 * so any file that imports `@tasermonkey/ic10-bench` brings these into the project's types; the
 * setup file (`@tasermonkey/ic10-bench/vitest`) installs the matchers themselves.
 */
import type { AutoYieldOptions, HaltExpectation, NoErrorsOptions, OnlyChangeOptions } from "./checks.ts";

export interface Ic10Matchers<R = unknown> {
	/** A device (or a chip's housing) has these property values; others aren't checked. */
	toHaveProps(expected: Record<string, unknown>): R;
	/** A chip register, by `r15` / `sp` / `ra` or an alias the script defined, has this value. */
	toHaveRegister(name: string, expected: unknown): R;
	/** A chip register is within `10^-digits / 2` of `expected` (default 2 digits). */
	toHaveRegisterCloseTo(name: string, expected: number, digits?: number): R;
	/** A chip's stack below `sp` is exactly this. */
	toHaveStack(expected: unknown[]): R;
	/** One of a chip's stack entries (what `get` / `put` address) has this value. */
	toHaveStackAt(index: number, expected: unknown): R;
	/** A chip runs this line next, or halted on it: a 0-based index or a label. */
	toBeAtLine(target: number | string): R;
	/** A chip hasn't halted and has no errors at or above `severity` (default "warning"). */
	toHaveNoErrors(options?: NoErrorsOptions): R;
	/** A chip halted on an error, optionally on this line and with a matching message or code. */
	toHaveHalted(expected?: HaltExpectation): R;
	/** Nothing but these paths changed: a world with `{ since: snapshot }`, or `world.diff(...)`. */
	toOnlyChange(paths: readonly string[], options?: OnlyChangeOptions): R;
	/** A recording (`world.record(...)`) changed value at most `n` times. */
	toToggleAtMost(n: number): R;
	/** A chip never ran out of lines in a tick: every loop path reaches a `yield` or `sleep`. */
	toNeverAutoYield(): R;
	/** A chip auto-yielded at most `n` times, in total or in any window of `perTicks` ticks. */
	toAutoYieldAtMost(n: number, options?: AutoYieldOptions): R;
}

declare module "vitest" {
	interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends Ic10Matchers<R> {}
}
