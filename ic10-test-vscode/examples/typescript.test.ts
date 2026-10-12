// Debugging the TypeScript too: see typescript.ic10. The room is modelled here, in TypeScript,
// as an event that runs every tick; a breakpoint in roomModel stops like one in the script.
import { sim, type World } from "@tasermonkey/ic10-bench";
import { describe, expect, it } from "vitest";

/** The room: the heater warms it 1.5 K a tick, and it loses 0.5 K a tick to the cold outside. */
function roomModel(w: World): void {
	const heating = w.device("heater").get("On") === 1;
	const change = heating ? 1.5 : -0.5;
	w.device("sensor").add("Temperature", change);
}

describe("typescript", () => {
	it("keeps the room between its limits with a heater", async () => {
		const world = await sim({ root: import.meta.dirname })
			.device("heater", "StructureWallHeater")
			.device("sensor", "StructureGasSensor", { Temperature: 293 })
			.housing("ic", { file: "typescript.ic10", pins: { d0: "heater", d1: "sensor" } })
			.build();
		world.every({ ticks: 1 }, roomModel, { label: "room" });
		const temperature = world.record("sensor.Temperature");
		const heater = world.record("heater.On");

		await world.runTicks(60);

		expect(Math.min(...temperature.values)).toBeGreaterThanOrEqual(289);
		expect(Math.max(...temperature.values)).toBeLessThanOrEqual(298);
		const switches = heater.values.filter((on, i) => i > 0 && on !== heater.values[i - 1]).length;
		expect(switches).toBeGreaterThanOrEqual(4); // on and off at least twice each
	});
});
