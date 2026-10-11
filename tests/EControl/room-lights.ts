/** Tests shared by the room EControl scripts, which switch every light on the network by occupancy. */
import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** Every light type the scripts switch. */
export const LIGHTS = [
	"StructureLightLongWide",
	"StructureLightLong",
	"StructureDiode",
	"StructureLightRound",
	"StructureLightRoundSmall",
	"StructureLightRoundAngled",
	"StructureWallLight",
	"StructureWallLightBattery",
	"StructureLightLongAngled",
] as const;

/** One light of each type, an occupancy sensor on d0 (and d1 for `sensors: 2`), and a grow light to leave alone. */
function build(script: string, sensors: 1 | 2) {
	let builder = sim({ root: REPO_ROOT });
	for (const prefab of LIGHTS) builder = builder.device(prefab, prefab);
	builder = builder
		.device("grow", "StructureGrowLight", { On: 1 })
		.device("sensor1", "StructureOccupancySensor")
		.device("sensor2", "StructureOccupancySensor");
	const pins = sensors === 2 ? { d0: "sensor1", d1: "sensor2" } : { d0: "sensor1" };
	return builder.housing("ic", { file: script, pins }).build();
}

export function describeRoomLights(script: string, { sensors }: { sensors: 1 | 2 }): void {
	describe("room lights", () => {
		it("turns every light on while someone is in the room, and off when they leave", async () => {
			const world = await build(script, sensors);
			await world.runSeconds(2);
			for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });

			world.device("sensor1").set("Activate", 1);
			await world.runSeconds(2);
			for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });

			world.device("sensor1").set("Activate", 0);
			await world.runSeconds(2);
			for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });

			expect(world.device("grow")).toHaveProps({ On: 1 }); // not a room light
			expect(world.chip("ic")).toHaveNoErrors();
			expect(world.chip("ic")).toNeverAutoYield();
		});

		if (sensors === 2) {
			it("counts someone seen by either sensor", async () => {
				const world = await build(script, sensors);
				world.device("sensor2").set("Activate", 1);
				await world.runSeconds(2);
				for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });
			});
		} else {
			it("ignores a second sensor", async () => {
				const world = await build(script, 2);
				world.device("sensor2").set("Activate", 1);
				await world.runSeconds(2);
				for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });
			});
		}
	});
}
