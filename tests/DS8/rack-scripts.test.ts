/**
 * Every script that runs in a DS-8 rack socket (`"host": "StructureServerRack"` in its
 * `.ic10.json`), but the audit probes, which test exactly this. In game, a chip's first run in a
 * socket can stop with IncorrectVariable at `sp` or `ra`, until the processor is reset (A8 and
 * A8b, ic10/DS8/Audit). So rack scripts use r16 (sp) and r17 (ra), which always work.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepoScript, REPO_ROOT } from "../support/paths.ts";

function rackScripts(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "Audit" ? [] : rackScripts(path);
		if (!entry.name.endsWith(".ic10.json")) return [];
		const host = (JSON.parse(readFileSync(path, "utf8")) as { host?: string }).host;
		return host === "StructureServerRack" ? [relative(REPO_ROOT, path.slice(0, -".json".length)).replaceAll("\\", "/")] : [];
	});
}

const SCRIPTS = rackScripts(join(REPO_ROOT, "ic10", "DS8"));

describe("DS-8 rack scripts", () => {
	it("are found", () => {
		expect(SCRIPTS.length).toBeGreaterThan(0);
	});

	for (const script of SCRIPTS) {
		it(`${script} doesn't name sp or ra, which a socket chip lacks`, () => {
			const named = readRepoScript(script)
				.split("\n")
				.flatMap((line, i) => (line.split("#")[0].split(/\s+/).some((word) => word === "sp" || word === "ra") ? [`line ${i}: ${line}`] : []));
			expect(named).toEqual([]);
		});
	}
});
