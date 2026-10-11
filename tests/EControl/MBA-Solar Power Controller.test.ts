import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const PANELS = [
	"StructureSolarPanel",
	"StructureSolarPanelDual",
	"StructureSolarPanelReinforced",
	"StructureSolarPanelDualReinforced",
] as const;

interface Setup {
	sun: { vertical: number; horizontal: number };
	/** A logic dial on d1 with this Setting (quarter turns of offset); none if left out. */
	dial?: number;
	/** Put the daylight sensor on d0 (default), or leave d0 empty so the script averages every sensor. */
	pinned?: boolean;
}

/** One panel of each kind, a daylight sensor, and optionally the offset dial. */
function build({ sun, dial, pinned = true }: Setup) {
	let builder = sim({ root: REPO_ROOT }).device("sensor", "StructureDaylightSensor", {
		Vertical: sun.vertical,
		Horizontal: sun.horizontal,
	});
	for (const prefab of PANELS) builder = builder.device(prefab, prefab);
	if (dial !== undefined) builder = builder.device("dial", "StructureLogicDial", { Setting: dial });
	const pins = { ...(pinned && { d0: "sensor" }), ...(dial !== undefined && { d1: "dial" }) };
	return builder.housing("ic", { file: "ic10/EControl/MBA-Solar Power Controller.ic10", pins }).build();
}

function expectPanels(world: Awaited<ReturnType<typeof build>>, props: { Vertical: number; Horizontal: number }) {
	for (const prefab of PANELS) expect(world.device(prefab)).toHaveProps(props);
}

describe("MBA-Solar Power Controller", () => {
	it("points every kind of panel at the sun: tilt |vertical − 90|, facing its heading", async () => {
		const world = await build({ sun: { vertical: 30, horizontal: 45 } });
		await world.runTicks(1);
		expectPanels(world, { Vertical: 60, Horizontal: 45 });
		expect(world.chip("ic")).toHaveNoErrors();
		expect(world.chip("ic")).toNeverAutoYield();
	});

	it("holds a tilt of 15 when the sun is low (vertical above 75)", async () => {
		const world = await build({ sun: { vertical: 80, horizontal: 45 } });
		await world.runTicks(1);
		expectPanels(world, { Vertical: 15, Horizontal: 45 });
	});

	it("parks the panels facing 270 at night (vertical above 95)", async () => {
		const world = await build({ sun: { vertical: 100, horizontal: 45 } });
		await world.runTicks(1);
		expectPanels(world, { Vertical: 15, Horizontal: 270 });
	});

	it("turns the heading by 90° per step of the offset dial, by day and at night", async () => {
		const world = await build({ sun: { vertical: 30, horizontal: 45 }, dial: 1 });
		await world.runTicks(1);
		expectPanels(world, { Vertical: 60, Horizontal: 135 });
		expect(world.device("dial")).toHaveProps({ Mode: 3 });

		world.device("sensor").set("Vertical", 100);
		await world.runTicks(1);
		expectPanels(world, { Vertical: 15, Horizontal: 360 });
	});

	it("averages every daylight sensor on the network when none is on d0", async () => {
		const world = await build({ sun: { vertical: 30, horizontal: 45 }, pinned: false });
		await world.runTicks(1);
		expectPanels(world, { Vertical: 60, Horizontal: 45 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("follows the sun as it moves", async () => {
		const world = await build({ sun: { vertical: 30, horizontal: 45 } });
		await world.runTicks(1);
		world.device("sensor").set("Vertical", 50).set("Horizontal", 120);
		await world.runTicks(1);
		expectPanels(world, { Vertical: 40, Horizontal: 120 });
	});
});
