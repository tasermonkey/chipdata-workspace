import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SCRIPT = "ic10/TraderControl/VCIC Trader Vert Input.ic10";

const BUTTONS = ["Add 1", "Add 5", "Add 10", "Sub 1", "Sub 5", "Sub 10"] as const;

/** The vertical input's console, with the horizontal chip's display on the same network. */
function build({ vertical = 0, horizontal = 0 } = {}) {
	let builder = sim({ root: REPO_ROOT })
		.device("vcValue", "ModularDeviceLEDdisplay3", { Setting: vertical }, { custom: true, name: "VC Current Value" })
		.device("hcValue", "ModularDeviceLEDdisplay3", { Setting: horizontal }, { custom: true, name: "HC Current Value" })
		.device("numpad", "ModularDeviceNumpad", { Mode: 1 }, { custom: true, name: "VC Num Pad" })
		.device("confirm", "ModularDeviceSquareButton", {}, { custom: true, name: "VC Num Pad Confirm" });
	for (const button of BUTTONS) {
		builder = builder.device(button, "ModularDeviceRoundButton", {}, { custom: true, name: `VC ${button}` });
	}
	return builder.housing("ic", { file: SCRIPT }).build();
}

describe("VCIC Trader Vert Input", () => {
	// CODE_REVIEW.md 1.10: copied from the Horz script, it zeroed the horizontal display on startup.
	it("leaves the horizontal display alone when it starts", async () => {
		const world = await build({ vertical: 30, horizontal: 45 });
		await world.runTicks(1);

		expect(world.device("hcValue")).toHaveProps({ Setting: 45 });
		expect(world.device("vcValue")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("adds and subtracts with the buttons, between 0 and 90", async () => {
		const world = await build();
		await world.runTicks(1);

		const press = async (button: (typeof BUTTONS)[number]) => {
			world.device(button).set("Activate", 1);
			await world.runTicks(1);
			world.device(button).set("Activate", 0);
		};
		await press("Add 10");
		await press("Add 5");
		expect(world.device("vcValue")).toHaveProps({ Setting: 15 });
		await press("Sub 1");
		expect(world.device("vcValue")).toHaveProps({ Setting: 14 });
		await press("Sub 10");
		await press("Sub 10");
		expect(world.device("vcValue")).toHaveProps({ Setting: 0 });

		for (let i = 0; i < 10; i++) await press("Add 10");
		expect(world.device("vcValue")).toHaveProps({ Setting: 90 });
		expect(world.device("hcValue")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("takes a value typed on the numpad when Confirm is pressed", async () => {
		const world = await build();
		await world.runTicks(1);

		// The numpad's Mode drops to 0 while a key is down, with the key in Setting.
		for (const key of [4, 2]) {
			world.device("numpad").set("Mode", 0);
			world.device("numpad").set("Setting", key);
			await world.runTicks(1);
		}
		expect(world.device("numpad")).toHaveProps({ Mode: 1, Setting: 42 });
		expect(world.device("vcValue")).toHaveProps({ Setting: 0 });

		world.device("confirm").set("Activate", 1);
		await world.runTicks(1);
		expect(world.device("vcValue")).toHaveProps({ Setting: 42 });
		expect(world.device("numpad")).toHaveProps({ Setting: 0 });
	});
});
