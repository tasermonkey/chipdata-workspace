import { describe, expect, it } from "vitest";
import { Color, type DeviceSpec, sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const OCCUPIED = 4; // the landing pad's Mode when a ship is docked, as the script reads it

/** For each dock: its landing pad data piece, a small and a large light, and a display, all named after the dock. */
function build(docks: Record<string, number>) {
	const devices = Object.entries(docks).flatMap(([dock, mode]): DeviceSpec[] => [
		[`${dock}.pad`, "Landingpad_DataConnectionPiece", { Mode: mode }, { name: dock }],
		[`${dock}.light`, "ModularDeviceLight", {}, { name: dock }],
		[`${dock}.large`, "ModularDeviceLightLarge", {}, { name: dock }],
		[`${dock}.display`, "ModularDeviceLEDdisplay2", {}, { name: dock }],
	]);
	return sim({ root: REPO_ROOT }).devices(devices).housing("ic", { file: "ic10/TraderControl/VCIC-DockOccupied.ic10" }).build();
}

describe("VCIC-DockOccupied", () => {
	it("gives each dock's large light its colour at startup", async () => {
		const world = await build({ "Green Dock": 0, "Orange Dock": 0, "Khaki Dock": 0, "Black Dock": 0, "Blue Dock": 0 });
		await world.runTicks(1);
		const colours = {
			"Green Dock": Color.Green,
			"Orange Dock": Color.Orange,
			"Khaki Dock": Color.Khaki,
			"Black Dock": Color.Black,
			"Blue Dock": Color.Blue,
		};
		for (const [dock, color] of Object.entries(colours)) expect(world.device(`${dock}.large`)).toHaveProps({ Color: color });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("lights a dock while a ship is on it, and shows the pad's mode", async () => {
		const world = await build({ "Green Dock": OCCUPIED, "Blue Dock": 1 });
		await world.runTicks(2);

		expect(world.device("Green Dock.light")).toHaveProps({ On: 1 });
		expect(world.device("Green Dock.large")).toHaveProps({ On: 1 });
		expect(world.device("Green Dock.display")).toHaveProps({ Setting: OCCUPIED });
		expect(world.device("Blue Dock.light")).toHaveProps({ On: 0 });
		expect(world.device("Blue Dock.large")).toHaveProps({ On: 0 });
		expect(world.device("Blue Dock.display")).toHaveProps({ Setting: 1 });

		world.device("Green Dock.pad").set("Mode", 0); // the ship left
		await world.runTicks(1);
		expect(world.device("Green Dock.light")).toHaveProps({ On: 0 });
		expect(world.chip("ic")).toNeverAutoYield();
	});

	it("lights a dock only for Landed, and shows every pad mode as it is", async () => {
		const modes = { None: 0, NoContact: 1, Moving: 2, Holding: 3, Landed: 4 };
		const docks = ["Green Dock", "Orange Dock", "Khaki Dock", "Black Dock", "Blue Dock"];
		const world = await build(Object.fromEntries(docks.map((dock, i) => [dock, i])));
		await world.runTicks(2);

		Object.entries(modes).forEach(([name, mode], i) => {
			const on = mode === OCCUPIED ? 1 : 0;
			expect(world.device(`${docks[i]}.light`), name).toHaveProps({ On: on });
			expect(world.device(`${docks[i]}.large`), name).toHaveProps({ On: on });
			expect(world.device(`${docks[i]}.display`), name).toHaveProps({ Setting: mode });
		});
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("follows a ship coming in to land, and leaving again", async () => {
		const world = await build({ "Orange Dock": 1 });
		await world.runTicks(2);
		for (const mode of [2, 3, OCCUPIED, 3, 2, 1]) {
			world.device("Orange Dock.pad").set("Mode", mode);
			await world.runTicks(1);
			const on = mode === OCCUPIED ? 1 : 0;
			expect(world.device("Orange Dock.light"), `mode ${mode}`).toHaveProps({ On: on });
			expect(world.device("Orange Dock.large"), `mode ${mode}`).toHaveProps({ On: on });
			expect(world.device("Orange Dock.display"), `mode ${mode}`).toHaveProps({ Setting: mode });
		}
		expect(world.chip("ic")).toHaveNoErrors();
	});
});
