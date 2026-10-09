/**
 * Vitest matchers for IC10 worlds. Importing this module installs them; add it to `setupFiles`:
 *
 * ```ts
 * test: { setupFiles: ["@tasermonkey/ic10-test/vitest"] }
 * ```
 */
import { expect, type MatcherState } from "vitest";
import {
	type AutoYieldOptions,
	checkAutoYieldAtMost,
	checkHalted,
	checkLine,
	checkNeverAutoYield,
	checkNoErrors,
	checkOnlyChange,
	checkProps,
	checkRegister,
	checkRegisterCloseTo,
	checkStack,
	checkStackAt,
	checkToggleAtMost,
	type HaltExpectation,
	type MatchContext,
	type NoErrorsOptions,
	type OnlyChangeOptions,
} from "./checks.ts";

declare module "vitest" {
	interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
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
}

function context(state: MatcherState): MatchContext {
	return { isNot: state.isNot, equals: (a, b) => state.equals(a, b, state.customTesters) };
}

/** The matchers, for `expect.extend`. Importing this module already installs them. */
export const ic10Matchers = {
	toHaveProps(this: MatcherState, received: unknown, expected: Record<string, unknown>) {
		return checkProps(received, expected, context(this));
	},
	toHaveRegister(this: MatcherState, received: unknown, name: string, expected: unknown) {
		return checkRegister(received, name, expected, context(this));
	},
	toHaveRegisterCloseTo(this: MatcherState, received: unknown, name: string, expected: number, digits?: number) {
		return checkRegisterCloseTo(received, name, expected, digits, context(this));
	},
	toHaveStack(this: MatcherState, received: unknown, expected: unknown[]) {
		return checkStack(received, expected, context(this));
	},
	toHaveStackAt(this: MatcherState, received: unknown, index: number, expected: unknown) {
		return checkStackAt(received, index, expected, context(this));
	},
	toBeAtLine(this: MatcherState, received: unknown, target: number | string) {
		return checkLine(received, target, context(this));
	},
	toHaveNoErrors(this: MatcherState, received: unknown, options?: NoErrorsOptions) {
		return checkNoErrors(received, options, context(this));
	},
	toHaveHalted(this: MatcherState, received: unknown, expected?: HaltExpectation) {
		return checkHalted(received, expected, context(this));
	},
	toOnlyChange(this: MatcherState, received: unknown, paths: readonly string[], options?: OnlyChangeOptions) {
		return checkOnlyChange(received, paths, options, context(this));
	},
	toToggleAtMost(this: MatcherState, received: unknown, n: number) {
		return checkToggleAtMost(received, n, context(this));
	},
	toNeverAutoYield(this: MatcherState, received: unknown) {
		return checkNeverAutoYield(received, context(this));
	},
	toAutoYieldAtMost(this: MatcherState, received: unknown, n: number, options?: AutoYieldOptions) {
		return checkAutoYieldAtMost(received, n, options, context(this));
	},
};

expect.extend(ic10Matchers);
