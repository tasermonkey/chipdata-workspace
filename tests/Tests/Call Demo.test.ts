import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../support/paths.ts";
import { sim } from "@tasermonkey/ic10-bench";

// tmsi, tmjc and tmjr come from @tasermonkey/ic10-bench-opext, which ic10-lint.json's "extensions" loads.
const SCRIPT = "ic10/Tests/Call Demo.ic10";

function build() {
	return sim({ root: REPO_ROOT }).housing("ic", { file: SCRIPT }).build();
}

describe("Call Demo", () => {
	it("shows fooCalc's result, and gets back every register it saved", async () => {
		const world = await build();
		await world.runUntil((w) => w.db("ic").get("Setting") === 176);
		const ic = world.chip("ic");
		for (const [reg, value] of [["r0", 176], ["r1", 43], ["r2", 44], ["r3", 45], ["r13", 2], ["r14", 8], ["r15", 80]] as const) {
			expect(ic).toHaveRegister(reg, value);
		}
		expect(ic).toHaveNoErrors();
	});

	it("returns from every call, so the call stack stays where tmsi put it", async () => {
		const world = await build();
		await world.runTicks(10);
		expect(world.chip("ic")).toHaveRegister("ra", 509);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
