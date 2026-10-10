import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** Console parts (custom devices), by in-game name. */
const DISPLAYS = [
	"VC Current Value", // the targets, set by the Trader Vert / Horz Input chips
	"HC Current Value",
	"MedSatVertical",
	"MedSatHorizontal",
	"MedSatPowerDisplay",
	"LargeSatVertical",
	"LargeSatHorizontal",
	"LargeSatPowerDisplay",
];

interface Console {
	target?: { vertical: number; horizontal: number };
	manual?: { medium?: number; large?: number };
	throttle?: { medium?: number; large?: number };
}

/** The medium dish "EchoStar", the large dish "Big-Boy", and the console that drives them. */
function build({ target = { vertical: 0, horizontal: 0 }, manual = {}, throttle = {} }: Console = {}) {
	let builder = sim({ root: REPO_ROOT })
		.device("medium", "StructureSatelliteDish", { Vertical: 20, Horizontal: 100, Idle: 1 }, { name: "EchoStar" })
		.device("large", "StructureLargeSatelliteDish", { Vertical: 40, Horizontal: 200, Idle: 1 }, { name: "Big-Boy" })
		.device("light", "ModularDeviceLight", {}, { custom: true, name: "SatState" });
	for (const name of DISPLAYS) {
		const Setting = name === "VC Current Value" ? target.vertical : name === "HC Current Value" ? target.horizontal : 0;
		builder = builder.device(name, "ModularDeviceLEDdisplay3", { Setting }, { custom: true, name });
	}
	const part = (key: string, prefab: string, name: string, Setting: number) =>
		builder.device(key, prefab, { Setting }, { custom: true, name });
	builder = part("mediumSwitch", "ModularDeviceFlipCoverSwitch", "MedSatManualSwitch", manual.medium ?? 0);
	builder = part("largeSwitch", "ModularDeviceFlipCoverSwitch", "LargeSatManualSwitch", manual.large ?? 0);
	builder = part("mediumThrottle", "ModularDeviceThrottle3x2", "MedSatPowerThrottle", throttle.medium ?? 0);
	builder = part("largeThrottle", "ModularDeviceThrottle3x2", "LargeSatPowerThrottle", throttle.large ?? 0);
	return builder.housing("ic", { file: "ic10/TraderControl/VCIC-Sat Control.ic10" }).build();
}

describe("VCIC-Sat Control", () => {
	it("shows where each dish is pointing", async () => {
		const world = await build();
		await world.runTicks(2);

		expect(world.device("MedSatVertical")).toHaveProps({ Setting: 20 });
		expect(world.device("MedSatHorizontal")).toHaveProps({ Setting: 100 });
		expect(world.device("LargeSatVertical")).toHaveProps({ Setting: 40 });
		expect(world.device("LargeSatHorizontal")).toHaveProps({ Setting: 200 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("sets each dish's power from its throttle: 500–7,500 W medium, 2,000–50,000 W large", async () => {
		const world = await build({ throttle: { medium: 0.5, large: 0.25 } });
		await world.runTicks(2);

		expect(world.device("medium")).toHaveProps({ Setting: 4000 });
		expect(world.device("MedSatPowerDisplay")).toHaveProps({ Setting: 4000, Mode: 2 });
		expect(world.device("large")).toHaveProps({ Setting: 14000 });
		expect(world.device("LargeSatPowerDisplay")).toHaveProps({ Setting: 14000, Mode: 2 });
		expect(world.db("ic")).toHaveProps({ Setting: 0.25 }); // the large throttle, for debugging
	});

	it("leaves a dish where it is while its manual switch is off", async () => {
		const world = await build({ target: { vertical: 60, horizontal: 300 } });
		await world.runTicks(3);
		expect(world.device("medium")).toHaveProps({ Vertical: 20, Horizontal: 100 });
		expect(world.device("large")).toHaveProps({ Vertical: 40, Horizontal: 200 });
	});

	it("points a dish at the Trader Vert / Horz targets while its manual switch is on", async () => {
		const world = await build({ target: { vertical: 60, horizontal: 300 }, manual: { large: 1 } });
		await world.runTicks(2);
		expect(world.device("large")).toHaveProps({ Vertical: 60, Horizontal: 300 });
		expect(world.device("medium")).toHaveProps({ Vertical: 20, Horizontal: 100 });

		world.device("mediumSwitch").set("Setting", 1);
		await world.runTicks(1);
		expect(world.device("medium")).toHaveProps({ Vertical: 60, Horizontal: 300 });
	});

	it("lights the yellow SatState light while the medium dish is moving", async () => {
		const world = await build();
		await world.runTicks(2);
		expect(world.device("light")).toHaveProps({ Color: 5, On: 0 });

		world.device("medium").set("Idle", 0);
		await world.runTicks(1);
		expect(world.device("light")).toHaveProps({ On: 1 });
	});
});
