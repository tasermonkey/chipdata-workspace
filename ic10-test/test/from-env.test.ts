import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvSchema } from "@stationeers-ic/ic10";
import { describe, expect, it } from "vitest";
import { World } from "../src/index.ts";

const ENV: EnvSchema = {
	version: 1,
	chips: [
		{
			id: 1,
			code: "alias Temp r0\nl Temp d0 Temperature\ns d1 On 1\ns db Setting Temp\nyield",
			registers: [{ name: "r5", value: 42 }],
			stack: [7, 8],
		},
	],
	networks: [
		{ id: "base", type: "data" },
		{ id: "power", type: "power" },
	],
	devices: [
		{
			id: 0x100,
			PrefabName: "StructureCircuitHousing",
			chip: 1,
			name: "Controller",
			ports: [
				{ port: "default", network: "power" },
				{ port: "default", network: "base" },
			],
			pins: [
				{ pin: "d0", device: 0x200 },
				{ pin: "d1", device: 0x300 },
			],
			props: [{ name: "Setting", value: 3 }],
		},
		{
			id: 0x200,
			PrefabName: "StructureGasSensor",
			name: "Outside",
			ports: [{ port: "default", network: "base" }],
			props: [{ name: "Temperature", value: 300 }],
		},
		{ id: 0x300, PrefabName: "StructureActiveVent", ports: [{ port: "default", network: "base" }] },
	],
};

describe("World.fromEnv", () => {
	it("keys devices by unique name, else by $hex ID, and keeps starting chip state", async () => {
		const world = await World.fromEnv(ENV, { debug: false });
		expect(world.listDevices().map((d) => d.key)).toEqual(["Controller", "Outside", "$300"]);
		expect(world.device("Outside").network).toBe("base");

		const chip = world.chip("Controller");
		expect(chip.source).toBe("<env>");
		expect(chip.pins).toEqual({ d0: "Outside", d1: "$300" });
		expect(chip).toHaveRegister("r5", 42);
		expect(chip).toHaveStack([7, 8]);
		expect(chip).toHaveProps({ Setting: 3 });

		await world.runTicks(1);
		expect(chip).toHaveRegister("Temp", 300);
		expect(world.device("$300")).toHaveProps({ On: 1 });
		expect(world.db("Controller")).toHaveProps({ Setting: 300 });
		expect(chip).toHaveNoErrors();
	});

	it("takes keys for chosen devices", async () => {
		const world = await World.fromEnv(ENV, { debug: false, testKeysById: { $300: "vent", 0x100: "ic" } });
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("Temp", 300);
		expect(world.device("vent")).toHaveProps({ On: 1 });
	});

	it("loads JSON text or a file relative to root", async () => {
		const fromText = await World.fromEnv(JSON.stringify(ENV), { debug: false });
		expect(fromText.chip("Controller")).toHaveRegister("r5", 42);

		const root = mkdtempSync(join(tmpdir(), "ic10-test-"));
		writeFileSync(join(root, "world.ic.json"), JSON.stringify(ENV));
		const fromFile = await World.fromEnv("world.ic.json", { root, debug: false });
		await fromFile.runTicks(1);
		expect(fromFile.device("$300")).toHaveProps({ On: 1 });
	});

	it("reports a script that doesn't parse, naming the device", async () => {
		const bad = { ...ENV, chips: [{ id: 1, code: "yield\nfoo bar baz" }] };
		await expect(World.fromEnv(bad, { debug: false })).rejects.toThrow(/"Controller" line 1: .*"foo bar baz"/);
	});
});
