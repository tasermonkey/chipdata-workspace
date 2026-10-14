import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const TARGET_SLOT = 255; // the Larre's "Target Slot": the plant at the arm
const DROP_OFF = 15;

/** A hydroponics Larre on d0, its station dial on d1, and the three debug displays at their IDs. */
function build(station: number) {
	return sim({ root: REPO_ROOT })
		.device("larre", "StructureLarreDockHydroponics")
		.device("dial", "StructureLogicDial", { Setting: station })
		.device("mature", "StructureConsoleLED5", {}, { id: "$4D655" })
		.device("seeding", "StructureConsoleLED5", {}, { id: "$4D61F" })
		.device("quantity", "StructureConsoleLED5", {}, { id: "$4D775" })
		.housing("ic", { file: "ic10/FoodControl/Larree Controller Debug.ic10", pins: { d0: "larre", d1: "dial" } })
		.build();
}

describe("Larree Controller Debug", () => {
	it("sends the Larre to the dialled station, and shows the plant there", async () => {
		const world = await build(3);
		world.device("larre").slot(TARGET_SLOT).put("ItemWheat", { Mature: 1, Seeding: 1, Quantity: 2 });
		await world.runTicks(1);

		expect(world.device("larre")).toHaveProps({ Setting: 3 });
		expect(world.device("mature")).toHaveProps({ Setting: 1 });
		expect(world.device("seeding")).toHaveProps({ Setting: 1 });
		expect(world.device("quantity")).toHaveProps({ Setting: 2 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("doesn't read a plant at the home (0) or drop-off station", async () => {
		for (const station of [0, DROP_OFF]) {
			const world = await build(station);
			world.device("larre").slot(TARGET_SLOT).put("ItemWheat", { Mature: 1 });
			await world.runTicks(1);

			expect(world.device("larre")).toHaveProps({ Setting: station });
			expect(world.device("mature")).toHaveProps({ Setting: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		}
	});

	// It passes the dial straight through, with no range check. Fine for a debug chip.
	it("sends a dial reading past the drop-off, or below 0, to the Larre unchanged", async () => {
		for (const station of [16, 40, -1]) {
			const world = await build(station);
			world.device("larre").slot(TARGET_SLOT).put("ItemWheat", { Mature: 1, Seeding: 0, Quantity: 3 });
			await world.runTicks(1);

			expect(world.device("larre"), `station ${station}`).toHaveProps({ Setting: station });
			expect(world.device("quantity"), `station ${station}`).toHaveProps({ Setting: 3 });
			expect(world.chip("ic")).toHaveNoErrors();
		}
	});

	it("retargets the Larre while it's still moving, and shows whatever plant is at the arm", async () => {
		const world = await build(3);
		world.device("larre").set("Idle", 0); // on its way to station 3
		world.device("larre").slot(TARGET_SLOT).put("ItemWheat", { Mature: 0, Seeding: -1, Quantity: 1 });
		await world.runTicks(1);
		expect(world.device("larre")).toHaveProps({ Setting: 3 });

		world.device("dial").set("Setting", 7);
		await world.runTicks(1);
		expect(world.device("larre")).toHaveProps({ Setting: 7 });
		expect(world.device("seeding")).toHaveProps({ Setting: -1 });
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
