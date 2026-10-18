/**
 * The station maps, stations/<station>.json: each chip's script is one ic10/ has, so renaming or
 * moving a script that a chip runs fails here, rather than in `npm run ic-link`.
 */
import { checkStations } from "@tasermonkey/ic10-link";
import { expect, it } from "vitest";
import { REPO_ROOT } from "./support/paths.ts";

it("maps chips only to scripts that exist", () => {
	expect(checkStations(REPO_ROOT)).toEqual([]);
});
