import { describe, expect, it } from "vitest";
import { Color, LedMode, sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const INCOMING = 1; // the weather station's Mode while a storm is on its way

/**
 * The weather station on d0, a warning light on d1 and an LED counter on d3. d1 must be a device
 * whose Color logic can be set: a Diode or console LED. A Flashing Light's colour is paint only.
 */
function build(station: { Mode: number; NextWeatherEventTime: number }) {
	return sim({ root: REPO_ROOT })
		.device("station", "StructureWeatherStation", station)
		.device("light", "StructureDiode")
		.device("counter", "StructureConsoleLED5")
		.housing("ic", { file: "ic10/TraderControl/VCIC - Weather.ic10", pins: { d0: "station", d1: "light", d3: "counter" } })
		.build();
}

describe("VCIC - Weather", () => {
	it("shows nothing, in white, while no storm is coming", async () => {
		const world = await build({ Mode: 0, NextWeatherEventTime: 0 });
		await world.runTicks(2);

		expect(world.device("light")).toHaveProps({ On: 0, Color: Color.White });
		expect(world.device("counter")).toHaveProps({ On: 0, Setting: 0, Color: Color.White, Mode: LedMode.Seconds });
		expect(world.db("ic")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("counts down to a storm in yellow once it's detected, blinking the light every tick", async () => {
		const world = await build({ Mode: INCOMING, NextWeatherEventTime: 300.4 });
		const blink = world.record("light.On");
		await world.runTicks(10);

		expect(world.device("counter")).toHaveProps({ On: 1, Setting: 300, Color: Color.Yellow });
		expect(world.device("light")).toHaveProps({ Color: Color.Yellow });
		expect(world.db("ic")).toHaveProps({ Setting: 1 });
		// Tick 0 only sets up and yields; from then on the light changes every tick.
		expect(blink.values).toEqual([0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("turns red when the storm is imminent: the last two minutes", async () => {
		const world = await build({ Mode: INCOMING, NextWeatherEventTime: 300 });
		await world.runTicks(2);
		world.device("station").set("NextWeatherEventTime", 120);
		await world.runTicks(2);
		expect(world.device("counter")).toHaveProps({ Setting: 120, Color: Color.Yellow }); // not yet

		world.device("station").set("NextWeatherEventTime", 119.6);
		await world.runTicks(2);
		expect(world.device("counter")).toHaveProps({ Setting: 120, Color: Color.Red });
		expect(world.device("light")).toHaveProps({ Color: Color.Red });
	});

	it("goes back to white once the storm has passed", async () => {
		const world = await build({ Mode: INCOMING, NextWeatherEventTime: 60 });
		await world.runTicks(2);
		world.device("station").set("Mode", 0).set("NextWeatherEventTime", 0);
		await world.runTicks(2);

		expect(world.device("light")).toHaveProps({ On: 0, Color: Color.White });
		expect(world.device("counter")).toHaveProps({ On: 0, Setting: 0 });
		expect(world.db("ic")).toHaveProps({ Setting: 0 });
	});
});
