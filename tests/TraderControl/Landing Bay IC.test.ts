import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { readRepoScript, REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/TraderControl/Landing Bay IC.ic10";

// The stage lives in the housing's Setting:
//   1 close door → 2 pump outside air out → 3 fill with breathable air → 4 closed, idle
//   5 pump breathable air back → 6 wait for vacuum → 7 let outside air in → 8 open, idle
const INWARD = 1; // vent Mode: pull air from the room into the pipe
const OUTWARD = 0;

/**
 * The hangar door, its two large vents, the hangar's gas sensor, the airlock switch, and the dish
 * with its dials. `extKpa` runs the script with EXT_KPA changed to that value.
 */
function build({ doorOpen, pressure, extKpa }: { doorOpen: 0 | 1; pressure: number; extKpa?: number }) {
	const program =
		extKpa === undefined
			? { file: SCRIPT }
			: { code: readRepoScript(SCRIPT).replace(/^define EXT_KPA \d+/m, `define EXT_KPA ${extKpa}`) };
	return sim({ root: REPO_ROOT })
		.device("door", "StructureLargeHangerDoor", { Open: doorOpen })
		.device("eject", "StructurePoweredVentLarge", {}, { name: "EjectVent" })
		.device("good", "StructurePoweredVentLarge", {}, { name: "GoodVent" })
		.device("sensor", "StructureGasSensor", { Pressure: pressure }, { name: "GSHangerBay" })
		.device("switch", "StructureLogicSwitch", { Open: doorOpen ? 0 : 1 }, { name: "AirLockControlSwitch" })
		.device("tilt", "StructureLogicDial", { Setting: 30 }, { name: "Dial-Tilt" })
		.device("rotate", "StructureLogicDial", { Setting: 120 }, { name: "Dial-Rotate" })
		.device("dish", "StructureLargeSatelliteDish", {}, { name: "Large Satillite Dish" })
		.housing("ic", { ...program })
		.build();
}

const stage = (world: World) => world.db("ic").get("Setting");
const reach = (world: World, n: number, maxTicks = 20) => world.runUntil((w) => stage(w) === n, { maxTicks });

describe("Landing Bay IC", () => {
	it("starts idle: stage 4 with the door closed", async () => {
		const world = await build({ doorOpen: 0, pressure: 100 });
		await world.runTicks(3);
		expect(stage(world)).toBe(4);
		expect(world.device("door")).toHaveProps({ Open: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	// The startup branch skipped 2 lines instead of 3, so with the door open the stage stayed 0 and
	// the switch could never close it.
	it("starts at stage 8, open and idle, when the door is already open", async () => {
		const world = await build({ doorOpen: 1, pressure: 5 });
		await world.runTicks(3);
		expect(stage(world)).toBe(8);
		expect(world.device("door")).toHaveProps({ Open: 1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("aims the large dish with the tilt and rotate dials", async () => {
		const world = await build({ doorOpen: 0, pressure: 100 });
		await world.runTicks(2);
		expect(world.device("dish")).toHaveProps({ Vertical: 30, Horizontal: 120 });
	});

	// GoodVent was switched off at the top of every pass, so it ran for one tick in stage 6 and the
	// hangar never emptied.
	it("opens: pumps the breathable air back until vacuum, then opens the door", async () => {
		const world = await build({ doorOpen: 0, pressure: 100 });
		await world.runTicks(3);

		world.device("switch").set("Open", 0); // ask for the door open
		await reach(world, 6);
		const good = world.record("good.On");
		await world.runTicks(6);
		expect(stage(world)).toBe(6); // the hangar still has air
		expect(world.device("good")).toHaveProps({ Mode: INWARD });
		expect(good.values.every((on) => on === 1)).toBe(true);
		expect(world.device("door")).toHaveProps({ Open: 0 });

		world.device("sensor").set("Pressure", 0);
		await reach(world, 8);
		expect(world.device("door")).toHaveProps({ Open: 1 });
		expect(world.device("good")).toHaveProps({ On: 0 });
		expect(world.device("eject")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("closes: shuts the door, pumps the outside air out, then fills with breathable air", async () => {
		const world = await build({ doorOpen: 1, pressure: 5 });
		await reach(world, 8);

		world.device("switch").set("Open", 1); // ask for the door closed
		await reach(world, 2);
		expect(world.device("door")).toHaveProps({ Open: 0 });
		await world.runTicks(3);
		expect(world.device("eject")).toHaveProps({ Mode: INWARD, On: 1 });
		expect(stage(world)).toBe(2);

		world.device("sensor").set("Pressure", 0); // outside air gone
		await reach(world, 3, 10);
		await world.runTicks(2); // past the handler's yield, once the vent is on
		const good = world.record("good.On");
		await world.runTicks(6);
		expect(world.device("good")).toHaveProps({ Mode: OUTWARD });
		expect(good.values.every((on) => on === 1)).toBe(true); // filling the whole time
		expect(world.device("eject")).toHaveProps({ On: 0 });

		world.device("sensor").set("Pressure", 100);
		await reach(world, 4, 10);
		expect(world.device("good")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("lets outside air in up to EXT_KPA before opening the door", async () => {
		const world = await build({ doorOpen: 0, pressure: 100, extKpa: 50 });
		await world.runTicks(3);
		world.device("switch").set("Open", 0);
		await reach(world, 6);
		world.device("sensor").set("Pressure", 0);
		await reach(world, 7);
		await world.runTicks(3);

		expect(world.device("eject")).toHaveProps({ Mode: OUTWARD, On: 1 });
		expect(world.device("door")).toHaveProps({ Open: 0 });

		world.device("sensor").set("Pressure", 50);
		await reach(world, 8);
		expect(world.device("eject")).toHaveProps({ On: 0 });
		expect(world.device("door")).toHaveProps({ Open: 1 });
	});

	it("doesn't change anything while the switch agrees with the door", async () => {
		const world = await build({ doorOpen: 0, pressure: 100 });
		await world.runTicks(3);
		const before = world.snapshot();
		await world.runTicks(10);
		expect(stage(world)).toBe(4);
		expect(world).toOnlyChange([], { since: before });
	});

	// CODE_REVIEW.md 2.2: stages 2 and 6 waited for exactly 0 kPa, which a real hangar may never read.
	it("counts anything up to EMPTY_KPA (1 kPa) as empty, opening and closing", async () => {
		const world = await build({ doorOpen: 0, pressure: 100 });
		await world.runTicks(3);
		world.device("switch").set("Open", 0);
		await reach(world, 6);
		world.device("sensor").set("Pressure", 1.5);
		await world.runTicks(6);
		expect(stage(world)).toBe(6); // not empty yet
		world.device("sensor").set("Pressure", 0.4);
		await reach(world, 8);

		world.device("switch").set("Open", 1);
		await reach(world, 2);
		world.device("sensor").set("Pressure", 1.5);
		await world.runTicks(6);
		expect(stage(world)).toBe(2);
		world.device("sensor").set("Pressure", 0.4);
		await reach(world, 3, 10);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
