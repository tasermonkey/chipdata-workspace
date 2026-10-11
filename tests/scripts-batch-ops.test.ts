/**
 * Every script's batch instructions (lb, lbn, lbs, lbns, sb, sbn, sbs) use properties their prefab
 * has, with the right Read/Write, per the device catalogue. No world is built, so this covers lines
 * no behaviour test reaches. A device type held in a register can't be checked this way.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBatchOps, findScripts, loadCatalog } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "./support/paths.ts";

const scripts = findScripts(`${REPO_ROOT}/ic10`).map((file) => [relative(REPO_ROOT, file).replaceAll("\\", "/"), file]);

describe("batch instructions match the device catalogue", () => {
	it.each(scripts)("%s", (_name, file) => {
		const findings = checkBatchOps(readFileSync(file, "utf8"), loadCatalog());
		expect(findings.map((f) => `line ${f.line + 1}: ${f.message}  (${f.text})`)).toEqual([]);
	});
});
