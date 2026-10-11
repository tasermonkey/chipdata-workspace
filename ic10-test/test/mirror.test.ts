import { describe, expect, it } from "vitest";
import { hash, type MirrorOptions, sim } from "../src/index.ts";

const SENSOR = hash("StructureGasSensor");
const MIRROR = hash("StructureLogicMirror");

/**
 * A gas sensor and an active vent on "outside", and on "base" a Logic Mirror ($200) for the sensor
 * and a chip with the mirror on d0.
 */
function world(code: string, mirror: MirrorOptions = { target: "sensor" }) {
	return sim({ debug: false })
		.network("base")
		.network("outside")
		.device("sensor", "StructureGasSensor", { RatioNitrogen: 0.7, Temperature: 250 }, { network: "outside", id: "$100" })
		.device("vent", "StructureActiveVent", {}, { network: "outside", id: "$101" })
		.mirror("mirror", { network: "base", id: "$200", ...mirror })
		.housing("ic", { code, network: "base", pins: { d0: "mirror" } })
		.build();
}

describe("Logic Mirror", () => {
	it("reads and writes its target through a pin", async () => {
		const w = await world("l r0 d0 RatioNitrogen\ns d0 On 1\nyield", { target: "vent" });
		w.mirror("mirror").setTarget("sensor");
		await w.step(1);
		expect(w.chip("ic").reg("r0")).toBe(0.7);
		w.mirror("mirror").setTarget("vent");
		await w.step(1);
		expect(w.device("vent").get("On")).toBe(1);
		expect(w.chip("ic")).toHaveNoErrors();
	});

	it("reads and writes its target by the mirror's reference ID", async () => {
		const w = await world("ld r0 $200 Temperature\nsd $200 Mode 1\nyield", { target: "sensor" });
		await w.step(1);
		expect(w.chip("ic").reg("r0")).toBe(250);
		w.mirror("mirror").setTarget("vent");
		await w.step(1);
		expect(w.device("vent").get("Mode")).toBe(1);
	});

	it("reads the target's PrefabHash and ReferenceId", async () => {
		const w = await world("l r0 d0 PrefabHash\nl r1 d0 ReferenceId\nyield");
		await w.runTicks(1);
		expect(w.chip("ic").reg("r0")).toBe(SENSOR);
		expect(w.chip("ic").reg("r1")).toBe(0x100);
	});

	it("unpowered, reads 0 and drops writes, without an error", async () => {
		const w = await world("loop:\nl r0 d0 PressureExternal\ns d0 On 1\nyield\nj loop", { target: "vent", powered: false });
		w.device("vent").set("PressureExternal", 300);
		await w.runTicks(1);
		expect(w.chip("ic").reg("r0")).toBe(0);
		expect(w.device("vent").get("On")).toBe(0);
		expect(w.chip("ic")).toHaveNoErrors();

		w.mirror("mirror").setPowered(true);
		await w.runTicks(1);
		expect(w.chip("ic").reg("r0")).toBe(300);
		expect(w.device("vent").get("On")).toBe(1);
	});

	it("with no target, halts the chip, as in game", async () => {
		const w = await world("l r0 d0 Temperature\nyield", {});
		await w.runTicks(1);
		expect(w.chip("ic")).toHaveHalted({
			line: 0,
			error: '"mirror" (StructureLogicMirror $200) has no target, so nothing can be read or written through it',
		});
	});

	it("halts on a logic type the target can't read, naming both, even unpowered", async () => {
		for (const powered of [true, false]) {
			const w = await world("l r0 d0 Setting\nyield", { target: "sensor", powered });
			await w.runTicks(1);
			expect(w.chip("ic").halt?.error.message).toMatch(
				/^"mirror" \(StructureLogicMirror \$200\) → "sensor" \(StructureGasSensor \$100\) has no logic type Setting; it has /,
			);
		}
	});

	it("doesn't pass on slots: ls halts the chip, as the mirror has none", async () => {
		const w = await world("ls r0 d0 0 Occupied\nyield");
		await w.runTicks(1);
		expect(w.chip("ic")).toHaveHalted({ line: 0 });
	});

	it("batch instructions see a Logic Mirror, not the target", async () => {
		const w = await world(`lb r0 ${SENSOR} Temperature Average\nlb r1 ${MIRROR} Temperature Average\nyield`);
		await w.runTicks(1);
		expect(w.chip("ic").reg("r0")).toBeNaN(); // no gas sensor on the chip's network
		expect(w.chip("ic").reg("r1")).toBe(250); // the mirror, reading through to the sensor
	});

	it("the target's own reference ID isn't on the mirror's network", async () => {
		const w = await world("ld r0 $100 Temperature\nyield");
		await w.runTicks(1);
		expect(w.chip("ic")).toHaveHalted({ line: 0 });
	});

	it("has no values of its own to get or set in a test", async () => {
		const w = await world("yield");
		expect(w.mirror("mirror").target?.key).toBe("sensor");
		expect(() => w.device("mirror").get("Temperature")).toThrow(
			'"mirror" is a Logic Mirror: it has no Temperature of its own; use world.device("sensor").Temperature',
		);
		expect(() => w.mirror("sensor")).toThrow(/is a StructureGasSensor, not a Logic Mirror/);
		expect(w.snapshot().values["mirror.PrefabHash"]).toBe(MIRROR);
	});

	it("needs a target that exists, and not itself", async () => {
		await expect(world("yield", { target: "nope" })).rejects.toThrow('sim: mirror "mirror" { target }: no device "nope"');
		await expect(world("yield", { target: "mirror" })).rejects.toThrow("can't be its own target");
	});
});
