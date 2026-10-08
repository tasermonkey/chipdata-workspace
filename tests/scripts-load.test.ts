/**
 * Sweep: every script under ic10/ must pass the emulator's validation (syntax, argument counts,
 * aliases, defines, labels). Scripts listed in KNOWN_FAILURES are expected to fail until the
 * named problem (a script bug or an emulator gap) is fixed; once one passes, its test fails so
 * the entry gets removed.
 */
import { ErrorSeverity, ValidateIc10Runner } from "@stationeers-ic/ic10";
import { describe, expect, it } from "vitest";
import { readRepoScript, repoScripts } from "./support/paths.ts";

const KNOWN_FAILURES: Record<string, string> = {
	// Aliases are case-sensitive: the alias is `Stage`, so line 58 `move stage 0` is invalid.
	"ic10/ClimateControl/Alaska IC Cooler [101290].ic10": "script bug, move stage 0 (see CODE_REVIEW.md)",
};

async function problems(path: string): Promise<string[]> {
	const code = readRepoScript(path);
	const lines = code.split("\n");
	const errors = await ValidateIc10Runner.validate(code, { jumpLimit: 100_000 });
	return errors
		.filter((e) => e.severity === ErrorSeverity.Strong || e.severity === ErrorSeverity.Critical)
		.filter((e) => !/jump_limit/.test(e.message))
		.map((e) => `line ${e.line}: ${e.message} :: ${(lines[e.line ?? -1] ?? "").trim()}`);
}

describe("every ic10/ script loads", () => {
	const scripts = repoScripts();

	it("finds the scripts", () => {
		expect(scripts.length).toBeGreaterThan(0);
	});

	for (const path of scripts) {
		const knownGap = KNOWN_FAILURES[path];
		if (knownGap) {
			it(`${path} (known gap: ${knownGap})`, async () => {
				expect(await problems(path), "now passes; remove it from KNOWN_FAILURES").not.toEqual([]);
			});
		} else {
			it(path, async () => {
				expect(await problems(path)).toEqual([]);
			});
		}
	}
});
