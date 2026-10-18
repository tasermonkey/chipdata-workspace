import { describe, expect, it } from "vitest";
import { readRepoScript, REPO_ROOT } from "../support/paths.ts";
import { sim } from "@tasermonkey/ic10-bench";

const SCRIPT = "ic10/Tests/Sync Demo Counter.ic10";
/** Read from the script, so changing it to see a deploy in game doesn't break these. */
const STEP = Number(/^define STEP (\S+)/m.exec(readRepoScript(SCRIPT))![1]);

function build(pins: { d0?: string } = {}) {
	return sim({ root: REPO_ROOT })
		.device("light", "StructureLightLong")
		.housing("ic", { file: SCRIPT, pins })
		.build();
}

describe("Sync Demo Counter", () => {
	it("counts up by STEP on the housing, with nothing on its pins", async () => {
		const world = await build();
		const setting = () => world.db("ic").get("Setting");
		await world.runUntil(() => setting() === STEP);
		await world.runUntil(() => setting() === 2 * STEP);
		await world.runUntil(() => setting() === 3 * STEP);
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("blinks the light: on with one count, off with the next", async () => {
		const world = await build({ d0: "light" });
		const setting = () => world.db("ic").get("Setting");
		await world.runUntil(() => setting() === STEP);
		expect(world.device("light")).toHaveProps({ On: 1 });
		await world.runUntil(() => setting() === 2 * STEP);
		expect(world.device("light")).toHaveProps({ On: 0 });
		await world.runUntil(() => setting() === 3 * STEP);
		expect(world.device("light")).toHaveProps({ On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
