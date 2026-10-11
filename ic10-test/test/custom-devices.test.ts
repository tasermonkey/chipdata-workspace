import { describe, expect, it } from "vitest";
import { sim } from "../src/index.ts";

describe("mods' devices (data/mods/)", () => {
	it("are found by type and name in batch reads and writes", async () => {
		const world = await sim({ debug: false })
			.device("gaugeA", "ModularDeviceGauge3x3", { Setting: 2 }, { name: "Power Delta" })
			.device("gaugeB", "ModularDeviceGauge3x3", { Setting: 5 }, { name: "Other" })
			.device("display", "ModularDeviceLEDdisplay3", {}, { name: "Power Delta" })
			.housing("ic", {
				code: [
					'define GAUGE HASH("ModularDeviceGauge3x3")',
					"lb r0 GAUGE Setting Sum",
					'lbn r1 GAUGE HASH("Power Delta") Setting Sum',
					'sbn GAUGE HASH("Other") Setting 9',
					'sb HASH("ModularDeviceLEDdisplay3") Color 4',
					"yield",
				].join("\n"),
			})
			.build();
		await world.runTicks(1);

		const ic = world.chip("ic");
		expect(ic).toHaveRegister("r0", 7);
		expect(ic).toHaveRegister("r1", 2); // the display has the same name but another type
		expect(world.device("gaugeB")).toHaveProps({ Setting: 9 });
		expect(world.device("gaugeA")).toHaveProps({ Setting: 2 });
		expect(world.device("display")).toHaveProps({ Color: 4 });
		expect(ic).toHaveNoErrors();
		expect(world.network("data").byType("ModularDeviceGauge3x3").map((d) => d.key)).toEqual(["gaugeA", "gaugeB"]);
		expect(world.network("data").byName("Power Delta")).toHaveLength(2);
	});

	it("are read and written by reference ID with ld / sd, and can be on a chip's pins", async () => {
		const world = await sim({ debug: false })
			.device("switch", "ModularDeviceFlipCoverSwitch", { Open: 1 }, { id: "$AE87A" })
			.device("dial", "ModularDeviceDial", { Setting: 3 })
			.device("vent", "StructureActiveVent")
			.housing("ic", {
				code: "ld r0 $AE87A Open\nsd $AE87A On 1\nl r1 d0 Setting\ns d0 Setting 8\ns d1 On 1\nyield",
				pins: { d0: "dial", d1: "vent" },
			})
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", 1);
		expect(world.chip("ic")).toHaveRegister("r1", 3);
		expect(world.device("switch")).toHaveProps({ On: 1 });
		expect(world.device("dial")).toHaveProps({ Setting: 8 });
		expect(world.device("vent")).toHaveProps({ On: 1 });
		expect(world.chip("ic").pins).toMatchObject({ d0: "dial", d1: "vent" });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("have only their own logic types, with the game's Read/Write", async () => {
		// The flip-cover switch has no Color (the export says so), unlike the plain Logic Switch.
		const noColour = await sim({ debug: false })
			.device("switch", "ModularDeviceFlipCoverSwitch", {}, { id: "$AE87A" })
			.housing("ic", { code: "sd $AE87A Color 4\nyield" })
			.build();
		await noColour.runTicks(1);
		expect(noColour.chip("ic")).toHaveHalted({ line: 0 });

		// A battery's Ratio is a reading: the test can set it, a script can't.
		const readOnly = await sim({ debug: false })
			.device("battery", "StationBatteryNuclear", { Ratio: 0.5 })
			.housing("ic", { code: "l r0 d0 Ratio\ns d0 Ratio 1\nyield", pins: { d0: "battery" } })
			.build();
		await readOnly.runTicks(1);
		expect(readOnly.chip("ic")).toHaveRegister("r0", 0.5);
		expect(readOnly.chip("ic")).toHaveHalted({ line: 1 });

		await expect(sim().device("dial", "ModularDeviceDial", { Color: 1 }).build()).rejects.toThrow(/has no logic property "Color"/);
	});

	it("have PrefabHash HASH(prefab) and their ReferenceId", async () => {
		const world = await sim({ debug: false })
			.device("battery", "StationBatteryNuclear", { Ratio: 0.5 }, { id: 0x2000 })
			.housing("ic", {
				code: 'l r0 d0 PrefabHash\nmove r1 HASH("StationBatteryNuclear")\nl r2 d0 ReferenceId\nyield',
				pins: { d0: "battery" },
			})
			.build();
		await world.runTicks(1);
		const ic = world.chip("ic");
		expect(ic.reg("r0")).toBe(ic.reg("r1"));
		expect(ic).toHaveRegister("r2", 0x2000);
		expect(world.device("battery").get("Ratio")).toBe(0.5);
	});

	it("show up in snapshots and diffs", async () => {
		const world = await sim({ debug: false })
			.device("gauge", "ModularDeviceGauge3x3")
			.housing("ic", { code: 'sb HASH("ModularDeviceGauge3x3") Setting 42\nyield' })
			.build();
		const before = world.snapshot();
		await world.runTicks(1);
		expect(world).toOnlyChange(["gauge.Setting"], { since: before });
	});

	it("must be on the housing's network to be pinned", async () => {
		const build = sim()
			.network("a")
			.network("b")
			.device("dial", "ModularDeviceDial", {}, { network: "b" })
			.housing("ic", { code: "yield", network: "a", pins: { d0: "dial" } })
			.build();
		await expect(build).rejects.toThrow(/"ic" d0: "dial" is on network "b", not "a"/);
	});
});

describe("game prefabs the emulator has data for but no device class", () => {
	it("are built with their own logic types", async () => {
		const world = await sim({ debug: false })
			.device("pad", "Landingpad_DataConnectionPiece", { Mode: 2 }, { name: "Green Dock" })
			.housing("ic", { code: 'lbn r0 HASH("Landingpad_DataConnectionPiece") HASH("Green Dock") Mode Maximum\nyield' })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", 2);
		expect(world.chip("ic")).toHaveNoErrors();
	});
});

describe("custom devices (in neither the emulator nor data/mods/)", () => {
	it("accept every logic property, readable and writable", async () => {
		const world = await sim({ debug: false })
			.device("widget", "ModFutureWidget", { Setting: 3 }, { custom: true, name: "W" })
			.housing("ic", { code: 'lbn r0 HASH("ModFutureWidget") HASH("W") Setting Maximum\ns d0 Color 4\nyield', pins: { d0: "widget" } })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", 3);
		expect(world.device("widget")).toHaveProps({ Color: 4 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("must be asked for: an unknown prefab is a build error", async () => {
		const build = sim().device("widget", "ModFutureWidget").housing("ic", { code: "yield" }).build();
		await expect(build).rejects.toThrow(/"widget": no device ModFutureWidget in the emulator or data\/mods\/.*custom: true/);
	});

	it("can't be a known prefab or a housing", async () => {
		const game = sim().device("vent", "StructureActiveVent", {}, { custom: true }).build();
		await expect(game).rejects.toThrow(/"vent": StructureActiveVent is a known device.*drop \{ custom: true \}/);
		const mod = sim().device("dial", "ModularDeviceDial", {}, { custom: true }).build();
		await expect(mod).rejects.toThrow(/"dial": ModularDeviceDial is a known device/);
		const housing = sim().housing("ic", { code: "yield", custom: true }).build();
		await expect(housing).rejects.toThrow(/housing "ic": a housing can't be custom/);
	});
});
