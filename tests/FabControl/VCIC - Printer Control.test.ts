import { describe, expect, it } from "vitest";
import { parseId, type ReferenceId, sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const SETUP = "ic10/FabControl/VCIC - Printer Setup.ic10";
const CONTROL = "ic10/FabControl/VCIC - Printer Control.ic10";

const GREEN = 2;
const RED = 4;

/** The reference IDs the setup chip hard-codes, one block of 12 stack slots per fabricator. */
const FABS = {
	autolathe: {
		block: 1,
		prefab: "StructureAutolathe",
		ids: { printer: "$1488", stacker: "$3606", progress: "$AE16A", amount: "$AE19B", power: "$AE87A",
			dial: "$AEF03", mode: "$AE0D8", plus: "$AEEEA", minus: "$AEEF9" },
	},
	electronics: {
		block: 13,
		prefab: "StructureElectronicsPrinter",
		ids: { printer: "$2736", stacker: "$360F", progress: "$C3042", amount: "$C3007", power: 797452,
			dial: "$C2AB1", mode: "$C2AF0", plus: "$C2A6A", minus: "$C2A6F" },
	},
	pipes: {
		block: 25,
		prefab: "StructureHydraulicPipeBender",
		ids: { printer: "$2217", stacker: "$3607", progress: "$C3D42", amount: "$C5295", power: 802081,
			dial: "$C3D17", mode: "$C3D27", plus: "$C3CF5", minus: "$C3CFA" },
	},
} satisfies Record<string, { block: number; prefab: string; ids: Record<string, ReferenceId> }>;

type Fab = keyof typeof FABS;
type Part = keyof (typeof FABS)[Fab]["ids"];

/** Console-mod parts (not in the emulator's catalogue). Control finds them by ID, so the prefab is cosmetic. */
const CONSOLE: Record<Exclude<Part, "printer" | "stacker">, string> = {
	progress: "ModularDeviceGauge3x3",
	amount: "ModularDeviceLEDdisplay3",
	power: "ModularDeviceFlipCoverSwitch",
	dial: "ModularDeviceDial",
	mode: "ModularDeviceFlipSwitch",
	plus: "ModularDeviceRoundButton",
	minus: "ModularDeviceRoundButton",
};

const key = (fab: Fab, part: Part) => `${fab}.${part}`;

/**
 * Every fabricator switched on, in manual mode with its dial at `dial`, part-way through a run. The
 * setup chip is declared first, so it fills Control's stack before Control's first line.
 */
function build({ dial = 20, power = {} as Partial<Record<Fab, number>> } = {}) {
	let builder = sim({ root: REPO_ROOT });
	for (const [fab, { prefab, ids }] of Object.entries(FABS) as [Fab, (typeof FABS)[Fab]][]) {
		builder = builder
			.device(key(fab, "printer"), prefab, { Activate: 1, ExportCount: 5, CompletionRatio: 0.25 }, { id: ids.printer })
			.device(key(fab, "stacker"), "StructureStacker", {}, { id: ids.stacker });
		for (const [part, prefab] of Object.entries(CONSOLE) as [keyof typeof CONSOLE, string][]) {
			const props: Record<string, number> =
				part === "power" ? { On: power[fab] ?? 1 } : part === "dial" ? { Setting: dial } : {};
			builder = builder.device(key(fab, part), prefab, props, { id: ids[part], custom: true });
		}
	}
	return builder
		.housing("setup", { file: SETUP, pins: { d0: "control" } })
		.housing("control", { file: CONTROL })
		.build();
}

/** A button press: Activate is 1 for one tick (0.5 s), then 0 again. */
function press(world: World, button: string) {
	world.device(button).set("Activate", 1);
	world.at({ tick: world.tick + 1 }, (w) => w.device(button).set("Activate", 0));
}

describe("VCIC - Printer Setup and Printer Control", () => {
	it("setup writes each fabricator's device IDs into Control's stack", async () => {
		const world = await build();
		await world.chip("setup").runToHalt({ maxTicks: 1 });

		expect(world.chip("setup").ended).toBe(true);
		const control = world.chip("control");
		expect(control).toHaveStackAt(0, 3); // fabricators
		for (const { block, ids } of Object.values(FABS)) {
			const order: Part[] = ["printer", "stacker", "progress", "amount", "power", "dial", "mode", "plus", "minus", "dial"];
			order.forEach((part, i) => expect(control).toHaveStackAt(block + i, parseId(ids[part])));
		}
	});

	it("drives each fabricator's own devices by reference ID", async () => {
		const world = await build({ dial: 20 });
		world.device(key("pipes", "printer")).set("ExportCount", 20); // the pipe bender has made enough
		world.device(key("electronics", "printer")).set("CompletionRatio", 0.75);
		await world.runTicks(4); // one fabricator per tick, last block first

		// The pipe bender reached its amount, so it's stopped and cleared; the others carry on.
		expect(world.device(key("pipes", "printer"))).toHaveProps({ Activate: 0 });
		expect(world.device(key("electronics", "printer"))).toHaveProps({ Activate: 1 });
		expect(world.device(key("autolathe", "printer"))).toHaveProps({ Activate: 1 });

		for (const fab of Object.keys(FABS) as Fab[]) {
			expect(world.device(key(fab, "power"))).toHaveProps({ Color: GREEN });
			expect(world.device(key(fab, "amount"))).toHaveProps({ Setting: 20, Mode: 0 });
			expect(world.device(key(fab, "stacker"))).toHaveProps({ Setting: 20 });
		}
		expect(world.device(key("electronics", "progress"))).toHaveProps({ Setting: 0.75 });
		expect(world.device(key("autolathe", "progress"))).toHaveProps({ Setting: 0.25 });
		expect(world.chip("control")).toHaveNoErrors();
	});

	it("changes the amount by 10 with the plus and minus buttons", async () => {
		const world = await build({ dial: 20 });
		await world.runTicks(1); // the chip's first tick ends before it reads any buttons
		press(world, key("autolathe", "plus"));
		press(world, key("electronics", "minus"));
		await world.runTicks(4);

		expect(world.device(key("autolathe", "dial"))).toHaveProps({ Setting: 30 });
		expect(world.device(key("autolathe", "amount"))).toHaveProps({ Setting: 30 });
		expect(world.device(key("electronics", "dial"))).toHaveProps({ Setting: 10 });
		expect(world.device(key("pipes", "dial"))).toHaveProps({ Setting: 20 });
		expect(world.chip("control")).toHaveNoErrors();
	});

	// CODE_REVIEW.md 2.9: a press is a one-tick pulse (wiki, Kit (Switch)), and Control read one
	// fabricator's buttons per tick, so with three fabricators it missed two presses in three.
	it("counts a one-tick press whenever it comes, for every fabricator", async () => {
		for (const fab of Object.keys(FABS) as Fab[]) {
			for (let offset = 0; offset < 4; offset++) {
				const world = await build({ dial: 20 });
				await world.runTicks(6 + offset);
				press(world, key(fab, "plus"));
				await world.runTicks(4);
				expect(world.device(key(fab, "dial")), `${fab}, offset ${offset}`).toHaveProps({ Setting: 30 });
				expect(world.device(key(fab, "amount")), `${fab}, offset ${offset}`).toHaveProps({ Setting: 30 });
			}
		}
	});

	it("fits each tick, button scan included, in 128 lines", async () => {
		const world = await build({ dial: 20 });
		await world.runTicks(5);
		press(world, key("pipes", "minus")); // a tick with a full button scan
		await world.runTicks(7);
		expect(world.chip("control")).toNeverAutoYield();
		expect(world.device(key("pipes", "dial"))).toHaveProps({ Setting: 10 });
	});

	it("turns a switched-off fabricator's light red and leaves it alone", async () => {
		const world = await build({ dial: 20, power: { electronics: 0 } });
		world.device(key("electronics", "printer")).set("ExportCount", 20);
		world.device(key("electronics", "printer")).set("CompletionRatio", 0.75);
		await world.runTicks(4);

		expect(world.device(key("electronics", "power"))).toHaveProps({ Color: RED });
		expect(world.device(key("electronics", "printer"))).toHaveProps({ Activate: 1 }); // not stopped
		expect(world.device(key("electronics", "amount"))).toHaveProps({ Setting: 0 });
		expect(world.device(key("electronics", "progress"))).toHaveProps({ Setting: 0 });

		// The fabricators either side of it are still handled.
		expect(world.device(key("pipes", "amount"))).toHaveProps({ Setting: 20 });
		expect(world.device(key("autolathe", "amount"))).toHaveProps({ Setting: 20 });
		expect(world.chip("control")).toHaveNoErrors();
	});

	it("shows STACK and takes the amount from the stacker's slot in stack mode", async () => {
		const world = await build({ dial: 20 });
		world.device(key("autolathe", "mode")).set("On", 1);
		await world.runTicks(4);

		const amount = world.device(key("autolathe", "amount"));
		expect(amount).toHaveProps({ Mode: 10 }); // text
		// With nothing in the stacker's slot, MaxQuantity reads 0 and the amount falls back to 500.
		expect(world.device(key("autolathe", "stacker"))).toHaveProps({ Setting: 500 });
		expect(world.device(key("pipes", "amount"))).toHaveProps({ Mode: 0, Setting: 20 });
	});
});
