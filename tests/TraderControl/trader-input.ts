/**
 * Tests shared by the Trader Vert and Horz Input scripts: the same console (buttons, numpad and a
 * display) with VC or HC names, setting one of the satellite dishes' target angles.
 */
import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const BUTTONS = ["Add 1", "Add 5", "Add 10", "Sub 1", "Sub 5", "Sub 10"] as const;
type Button = (typeof BUTTONS)[number];

export interface TraderInputSpec {
	script: string;
	/** This chip's name prefix ("VC" or "HC"), and the other chip's. */
	prefix: string;
	other: string;
}

/** This chip's console, with the other chip's display ("other") on the same network. */
function build(spec: TraderInputSpec, { own = 0, other = 0 } = {}) {
	const custom = (name: string) => ({ custom: true, name: `${spec.prefix} ${name}` });
	let builder = sim({ root: REPO_ROOT })
		.device("value", "ModularDeviceLEDdisplay3", { Setting: own }, custom("Current Value"))
		.device("other", "ModularDeviceLEDdisplay3", { Setting: other }, { custom: true, name: `${spec.other} Current Value` })
		.device("numpad", "ModularDeviceNumpad", { Mode: 1 }, custom("Num Pad"))
		.device("confirm", "ModularDeviceSquareButton", {}, custom("Num Pad Confirm"));
	for (const button of BUTTONS) builder = builder.device(button, "ModularDeviceRoundButton", {}, custom(button));
	return builder.housing("ic", { file: spec.script }).build();
}

/** Hold a button down for one tick. */
export async function press(world: World, button: Button) {
	world.device(button).set("Activate", 1);
	await world.runTicks(1);
	world.device(button).set("Activate", 0);
}

/** Build the console and run the chip's startup. */
export async function startConsole(spec: TraderInputSpec, values?: { own?: number; other?: number }) {
	const world = await build(spec, values);
	await world.runTicks(1);
	return world;
}

export function describeTraderInput(spec: TraderInputSpec): void {
	describe("console", () => {
		it(`zeroes its own display when it starts, and leaves the ${spec.other} one alone`, async () => {
			const world = await startConsole(spec, { own: 30, other: 45 });
			expect(world.device("value")).toHaveProps({ Setting: 0 });
			expect(world.device("other")).toHaveProps({ Setting: 45 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("adds and subtracts with the buttons", async () => {
			const world = await startConsole(spec);
			await press(world, "Add 10");
			await press(world, "Add 5");
			expect(world.device("value")).toHaveProps({ Setting: 15 });
			await press(world, "Sub 1");
			expect(world.device("value")).toHaveProps({ Setting: 14 });
			await press(world, "Sub 5");
			expect(world.device("value")).toHaveProps({ Setting: 9 });
			expect(world.device("other")).toHaveProps({ Setting: 0 });
			expect(world.chip("ic")).toHaveNoErrors();
		});

		it("takes a value typed on the numpad when Confirm is pressed", async () => {
			const world = await startConsole(spec);

			// The numpad's Mode drops to 0 while a key is down, with the key in Setting.
			for (const key of [4, 2]) {
				world.device("numpad").set("Mode", 0);
				world.device("numpad").set("Setting", key);
				await world.runTicks(1);
			}
			expect(world.device("numpad")).toHaveProps({ Mode: 1, Setting: 42 });
			expect(world.device("value")).toHaveProps({ Setting: 0 });

			world.device("confirm").set("Activate", 1);
			await world.runTicks(1);
			expect(world.device("value")).toHaveProps({ Setting: 42 });
			expect(world.device("numpad")).toHaveProps({ Setting: 0 });
		});
	});
}
