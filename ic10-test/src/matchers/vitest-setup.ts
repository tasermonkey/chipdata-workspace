/**
 * Vitest matchers for IC10 worlds. Importing this module installs them; `defineIc10Config` adds it
 * to `setupFiles`, or add it yourself:
 *
 * ```ts
 * test: { setupFiles: ["@tasermonkey/ic10-bench/vitest"] }
 * ```
 *
 * Their types are in types.ts.
 */
import { afterAll, expect, type MatcherState } from "vitest";
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

export type { Ic10Matchers } from "./types.ts";

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

// Launched by the VS Code debugger (IC10_DEBUG=<port>): connect to it, so this file's worlds can be
// stepped through. Tests need no changes.
const debugAddress = process.env.IC10_DEBUG;
if (debugAddress) {
	const { attachDebugger } = await import("../debug/attach.ts");
	const attached = await attachDebugger(debugAddress);
	afterAll(() => attached.close());
}
