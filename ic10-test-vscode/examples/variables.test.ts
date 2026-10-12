// The Variables panel, editing values, hovers, Watch and the Debug Console: see variables.ic10.
import { PIPE_VOLUME, sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

describe("variables", () => {
	it("switches the vent on while it's warm outside", async () => {
		const world = await sim({ root: import.meta.dirname })
			.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 290, pressure: 500, ratios: { Nitrogen: 1 } })
			.room("outside", { temperature: 320, pressure: 100, ratios: { Nitrogen: 0.8, Oxygen: 0.2 } })
			.device("vent", "StructureActiveVent", {}, { ports: { output: "coolant" }, room: "outside" })
			.device("sensor", "StructureGasSensor", {}, { room: "outside" })
			.device("pa", "StructurePipeAnalysizer", {}, { pipe: "coolant" })
			.housing("ic", { file: "variables.ic10", pins: { d0: "vent", d1: "sensor" } })
			.build();
		await world.runTicks(3);

		const ic = world.chip("ic");
		expect(ic).toHaveRegister("Stage", 4);
		expect(ic).toHaveRegister("r1", world.device("vent").id);
		expect(ic).toHaveStack([7, 8]);
		expect(ic).toHaveStackAt(10, 3);
		expect(ic).toHaveProps({ Setting: 8 + 3 }); // peek and get read them
		expect(world.device("vent")).toHaveProps({ On: 1 });
		expect(ic).toHaveNoErrors();
	});
});
