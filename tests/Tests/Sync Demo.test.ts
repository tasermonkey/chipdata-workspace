import { describe, expect, it } from "vitest";
import { readRepoScript, REPO_ROOT } from "../support/paths.ts";
import { sim } from "@tasermonkey/ic10-bench";

const SCRIPT = "ic10/Tests/Sync Demo.ic10";
/** Read from the script, so changing it to see a deploy in game doesn't break these. */
const VERSION = Number(/^define VERSION (\S+)/m.exec(readRepoScript(SCRIPT))![1]);

function build(pins: { d0?: string; d1?: string } = {}) {
	return sim({ root: REPO_ROOT })
		.device("lever", "StructureLogicSwitch")
		.device("light", "StructureLightLong")
		.housing("ic", { file: SCRIPT, pins })
		.build();
}

describe("Sync Demo", () => {
	it("shows VERSION on the housing, with nothing on its pins", async () => {
		const world = await build();
		await world.runSeconds(1);
		expect(world.db("ic")).toHaveProps({ Setting: VERSION });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns the light on and off with the lever", async () => {
		const world = await build({ d0: "lever", d1: "light" });
		await world.runSeconds(1);
		expect(world.device("light")).toHaveProps({ On: 0 });

		world.device("lever").set("Open", 1);
		await world.runSeconds(1);
		expect(world.device("light")).toHaveProps({ On: 1 });

		world.device("lever").set("Open", 0);
		await world.runSeconds(1);
		expect(world.device("light")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("keeps running with a lever and no light", async () => {
		const world = await build({ d0: "lever" });
		world.device("lever").set("Open", 1);
		await world.runSeconds(1);
		expect(world.db("ic")).toHaveProps({ Setting: VERSION });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
