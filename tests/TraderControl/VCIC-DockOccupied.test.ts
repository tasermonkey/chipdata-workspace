import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const OCCUPIED = 4; // the landing pad's Mode when a ship is docked, as the script reads it

/** For each dock: its landing pad data piece, a small and a large light, and a display, all named after the dock. */
function build(docks: Record<string, number>) {
	let builder = sim({ root: REPO_ROOT });
	for (const [dock, mode] of Object.entries(docks)) {
		const name = { name: dock };
		builder = builder
			.device(`${dock}.pad`, "Landingpad_DataConnectionPiece", { Mode: mode }, name)
			.device(`${dock}.light`, "ModularDeviceLight", {}, name)
			.device(`${dock}.large`, "ModularDeviceLightLarge", {}, name)
			.device(`${dock}.display`, "ModularDeviceLEDdisplay2", {}, name);
	}
	return builder.housing("ic", { file: "ic10/TraderControl/VCIC-DockOccupied.ic10" }).build();
}

describe("VCIC-DockOccupied", () => {
	it("gives each dock's large light its colour at startup", async () => {
		const world = await build({ "Green Dock": 0, "Orange Dock": 0, "Khaki Dock": 0, "Black Dock": 0, "Blue Dock": 0 });
		await world.runTicks(1);
		const colours = { "Green Dock": 2, "Orange Dock": 3, "Khaki Dock": 9, "Black Dock": 7, "Blue Dock": 0 };
		for (const [dock, Color] of Object.entries(colours)) expect(world.device(`${dock}.large`)).toHaveProps({ Color });
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
});
