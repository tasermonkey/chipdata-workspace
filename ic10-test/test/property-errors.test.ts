import { describe, expect, it } from "vitest";
import { sim } from "../src/index.ts";

/** The message a chip halted with, or its recorded errors' messages. */
async function messages(code: string, pins: Record<string, string> = {}) {
	const world = await sim({ debug: false })
		.device("switch", "ModularDeviceFlipCoverSwitch", {}, { id: "$AE87A" })
		.device("battery", "StationBatteryNuclear", { Ratio: 0.5 })
		.device("vent", "StructureActiveVent", {}, { name: "Vent 1" })
		.device("widget", "ModFutureWidget", {}, { custom: true })
		.housing("ic", { code, pins })
		.build();
	await world.runTicks(1);
	const chip = world.chip("ic");
	return { halt: chip.halt?.error.message, errors: chip.errors.map((e) => e.message) };
}

describe("property errors name the device and what it has", () => {
	it("writing a read-only property, through a pin", async () => {
		const { halt } = await messages("s d0 Ratio 1\nyield", { d0: "battery" });
		expect(halt).toBe('"battery" (StationBatteryNuclear $1001) can\'t write Ratio: it\'s read-only; writable: Lock, On');
	});

	it("writing a property the device doesn't have, by reference ID", async () => {
		const { halt } = await messages("sd $AE87A Color 4\nyield");
		expect(halt).toBe(
			'"switch" (ModularDeviceFlipCoverSwitch $AE87A) has no logic type Color; it has NameHash, On, Open, PrefabHash, ReferenceId, Setting',
		);
	});

	it("reading one it doesn't have (a warning: the chip carries on), listing the first 16", async () => {
		const { halt, errors } = await messages("l r0 d0 Activate\nyield", { d0: "vent" });
		expect(halt).toBeUndefined();
		expect(errors).toEqual([
			expect.stringMatching(/^"vent" \(StructureActiveVent \$1002\) has no logic type Activate; it has CombustionOutput, .* and \d+ more$/),
		]);
	});

	it("in a batch write, naming one of the devices", async () => {
		const { halt } = await messages('sbn HASH("StructureActiveVent") HASH("Vent 1") PressureOutput 5\nyield');
		expect(halt).toMatch(/^"vent" \(StructureActiveVent \$1002\) can't write PressureOutput: it's read-only; writable: /);
	});

	it("work with toHaveHalted's error pattern", async () => {
		const world = await sim({ debug: false })
			.device("battery", "StationBatteryNuclear")
			.housing("ic", { code: "s d0 Ratio 1\nyield", pins: { d0: "battery" } })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveHalted({ line: 0, error: /can't write Ratio: it's read-only/ });
	});
});
