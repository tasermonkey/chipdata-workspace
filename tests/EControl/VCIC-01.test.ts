import { describe, expect, it } from "vitest";
import { readRepoScript } from "../support/paths.ts";
import { describeRoomLights } from "./room-lights.ts";

const SCRIPT = "ic10/EControl/VCIC-01.ic10";

/** The script's lines with indentation, trailing spaces and the final newline dropped. */
const code = (path: string) => readRepoScript(path).trimEnd().split(/\r?\n/).map((line) => line.trim());

describe("VCIC-01", () => {
	describeRoomLights(SCRIPT, { sensors: 2, sleeps: true });

	// CODE_REVIEW.md 3.1: the two are copies. If one changes, change the other or merge them.
	it("is the Storage Room script, apart from indentation", () => {
		expect(code(SCRIPT)).toEqual(code("ic10/EControl/VCIC Storage Room(1) EControl.ic10"));
	});
});
