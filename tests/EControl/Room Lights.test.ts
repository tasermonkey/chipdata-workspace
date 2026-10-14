import { describe, expect, it } from "vitest";
import { readRepoScript, REPO_ROOT } from "../support/paths.ts";
import { sim } from "@tasermonkey/ic10-bench";

const SCRIPT = "ic10/EControl/Room Lights.ic10";
const ROOM = "Room Light"; // the script's ROOM_LIGHT

/** Every light type the script switches. */
const LIGHTS = [
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

/**
 * One light of each type named for the room, another room's light of the same type, a grow light,
 * and an occupancy sensor on d0 (and on d1 with `sensors: 2`). `room` runs the script with
 * ROOM_LIGHT set to that name.
 */
function build({ sensors = 1, room }: { sensors?: 1 | 2; room?: string } = {}) {
	const program =
		room === undefined ? { file: SCRIPT } : { code: readRepoScript(SCRIPT).replace(/HASH\("Room Light"\)/, `HASH("${room}")`) };
	const pins = sensors === 2 ? { d0: "sensor1", d1: "sensor2" } : { d0: "sensor1" };
	return sim({ root: REPO_ROOT })
		.devices(LIGHTS.map((prefab) => [prefab, prefab, {}, { name: room ?? ROOM }] as const))
		.device("hallLight", "StructureLightLong", {}, { name: "Hall Light" })
		.device("grow", "StructureGrowLight", { On: 1 })
		.device("sensor1", "StructureOccupancySensor")
		.device("sensor2", "StructureOccupancySensor")
		.housing("ic", { ...program, pins })
		.build();
}

describe("Room Lights", () => {
	it("turns every light in the room on while someone is there, and off when they leave", async () => {
		const world = await build();
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });

		world.device("sensor1").set("Activate", 1);
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });
		expect(world.db("ic")).toHaveProps({ Setting: 1 }); // occupied

		world.device("sensor1").set("Activate", 0);
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });
		expect(world.db("ic")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toNeverAutoYield();
	});

	// The old room scripts' sb switched every light of a type on the network, another room's too.
	it("leaves another room's lights and the grow lights alone", async () => {
		const world = await build();
		world.device("hallLight").set("On", 1);
		world.device("sensor1").set("Activate", 0);
		await world.runSeconds(2);
		expect(world.device("hallLight")).toHaveProps({ On: 1 });
		expect(world.device("grow")).toHaveProps({ On: 1 });

		world.device("hallLight").set("On", 0);
		world.device("sensor1").set("Activate", 1);
		await world.runSeconds(2);
		expect(world.device("hallLight")).toHaveProps({ On: 0 });
		expect(world.device("grow")).toHaveProps({ On: 1 });
	});

	it("switches the lights named in ROOM_LIGHT", async () => {
		const world = await build({ room: "Kitchen Light" });
		world.device("sensor1").set("Activate", 1);
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });
		expect(world.device("hallLight")).toHaveProps({ On: 0 });
	});

	it("counts someone seen by a second sensor on d1", async () => {
		const world = await build({ sensors: 2 });
		world.device("sensor2").set("Activate", 1);
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("works with nothing on d1", async () => {
		const world = await build({ sensors: 1 });
		world.device("sensor2").set("Activate", 1); // on the network, but not on a pin
		await world.runSeconds(2);
		for (const light of LIGHTS) expect(world.device(light)).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("sleeps between passes", async () => {
		const world = await build();
		await world.runUntil((w) => w.chip("ic").sleeping, { maxTicks: 5 });
	});
});
