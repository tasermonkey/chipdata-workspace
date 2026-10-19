/**
 * The station maps, stations/<station>.json: each chip's script is one ic10/ has, so renaming or
 * moving a script that a chip runs fails here, rather than in `npm run ic-link`. Likewise a
 * script's per-chip file, `<script>.ic10.json`, must still have its script beside it.
 */
import { checkPerChipFiles, checkStations } from "@tasermonkey/ic10-link";
import { expect, it } from "vitest";
import { REPO_ROOT } from "./support/paths.ts";

it("maps chips only to scripts that exist", () => {
	expect(checkStations(REPO_ROOT)).toEqual([]);
});

it("has a script beside every per-chip file", () => {
	expect(checkPerChipFiles(REPO_ROOT)).toEqual([]);
});
