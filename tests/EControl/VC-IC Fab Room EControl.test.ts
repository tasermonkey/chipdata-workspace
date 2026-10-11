import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** The machines the script lists by reference ID. */
const MACHINES = [
	["autolathe1", "StructureAutolathe", "$1486"],
	["autolathe2", "StructureAutolathe", "$1488"],
	["pipeBender1", "StructureHydraulicPipeBender", "$2217"],
	["pipeBender2", "StructureHydraulicPipeBender", "$2235"],
	["toolbench", "StructureToolManufactory", "$482A"],
	["recycler", "StructureRecycler", "$6E4F"],
	["electronics1", "StructureElectronicsPrinter", "$2736"],
	["electronics2", "StructureElectronicsPrinter", "$279C"],
] as const;

const LIGHT_NAME = "Manufacturing Room - Light";
const LIGHTS = ["StructureLightLongWide", "StructureLightLong", "StructureDiode"] as const;

function build() {
	let builder = sim({ root: REPO_ROOT });
	for (const [key, prefab, id] of MACHINES) builder = builder.device(key, prefab, { On: 1 }, { id });
	for (const prefab of LIGHTS) builder = builder.device(prefab, prefab, {}, { name: LIGHT_NAME });
	return builder
		.device("hallLight", "StructureLightLong", {}, { name: "Hall Light" })
		.device("sensor", "StructureOccupancySensor")
		.housing("ic", { file: "ic10/EControl/VC-IC Fab Room EControl.ic10", pins: { d0: "sensor" } })
		.build();
}

describe("VC-IC Fab Room EControl", () => {
	it("turns the room's lights and machines on while someone is there", async () => {
		const world = await build();
		world.device("sensor").set("Activate", 1);
		await world.runSeconds(2);

		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });
		for (const [key] of MACHINES) expect(world.device(key)).toHaveProps({ On: 1 });
		expect(world.device("hallLight")).toHaveProps({ On: 0 }); // another room's light
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("once the room is empty, turns off the lights and every machine that isn't mid-job", async () => {
		const world = await build();
		world.device("pipeBender2").set("Activate", 1); // printing something
		await world.runSeconds(2);

		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });
		for (const [key] of MACHINES) {
			expect(world.device(key)).toHaveProps({ On: key === "pipeBender2" ? 1 : 0 });
		}

		world.device("pipeBender2").set("Activate", 0); // the job finished
		await world.runSeconds(2);
		expect(world.device("pipeBender2")).toHaveProps({ On: 0 });
	});
});
