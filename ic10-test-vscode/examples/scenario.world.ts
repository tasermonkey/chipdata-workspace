// Launching from a scenario: see scenario.ic10. A world module's default export builds the world
// and returns it, with any events and models; the debugger runs it until you stop it.
import { sim } from "@tasermonkey/ic10-bench";

export default async function () {
	const world = await sim({ root: import.meta.dirname })
		.device("sensor", "StructureGasSensor", { Temperature: 290 })
		.device("light", "StructureWallLight")
		.housing("ic", { file: "scenario.ic10", pins: { d0: "sensor", d1: "light" } })
		.build();
	world.every({ ticks: 60 }, (w) => w.device("sensor").set("Temperature", 250), { label: "nightfall", start: { tick: 30 } });
	world.every({ ticks: 60 }, (w) => w.device("sensor").set("Temperature", 290), { label: "daybreak", start: { tick: 60 } });
	return world;
}
