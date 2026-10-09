import { describe, expect, it } from "vitest";
import { sim } from "../src/index.ts";

describe("custom devices (not in the emulator's catalogue)", () => {
	it("are found by type and name in batch reads and writes", async () => {
		const world = await sim({ debug: false })
			.device("gaugeA", "ModularDeviceGauge3x3", { Setting: 2 }, { custom: true, name: "Power Delta" })
			.device("gaugeB", "ModularDeviceGauge3x3", { Setting: 5 }, { custom: true, name: "Other" })
			.device("display", "ModularDeviceLEDdisplay3", {}, { custom: true, name: "Power Delta" })
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

	it("are read and written by reference ID with ld / sd", async () => {
		const world = await sim({ debug: false })
			.device("switch", "ModularDeviceFlipCoverSwitch", { Open: 1 }, { custom: true, id: "$AE87A" })
			.housing("ic", { code: "ld r0 $AE87A Open\nsd $AE87A Color 4\nyield" })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", 1);
		expect(world.device("switch")).toHaveProps({ Color: 4 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("can be on a chip's pins", async () => {
		const world = await sim({ debug: false })
			.device("dial", "ModularDeviceDial", { Setting: 3 }, { custom: true })
			.device("vent", "StructureActiveVent")
			.housing("ic", { code: "l r0 d0 Setting\ns d0 Setting 8\ns d1 On 1\nyield", pins: { d0: "dial", d1: "vent" } })
			.build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", 3);
		expect(world.device("dial")).toHaveProps({ Setting: 8 });
		expect(world.device("vent")).toHaveProps({ On: 1 });
		expect(world.chip("ic").pins).toMatchObject({ d0: "dial", d1: "vent" });
	});

	it("have PrefabHash HASH(prefab) and their ReferenceId", async () => {
		const world = await sim({ debug: false })
			.device("battery", "StationBatteryNuclear", { Ratio: 0.5 }, { custom: true, id: 0x2000 })
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
			.device("gauge", "ModularDeviceGauge3x3", {}, { custom: true })
			.housing("ic", { code: 'sb HASH("ModularDeviceGauge3x3") Setting 42\nyield' })
			.build();
		const before = world.snapshot();
		await world.runTicks(1);
		expect(world).toOnlyChange(["gauge.Setting"], { since: before });
	});

	it("must be asked for: an unknown prefab is a build error", async () => {
		const build = sim().device("gauge", "ModularDeviceGauge3x3").housing("ic", { code: "yield" }).build();
		await expect(build).rejects.toThrow(/"gauge": the emulator has no device ModularDeviceGauge3x3.*custom: true/);
	});

	it("can't be a catalogued prefab or a housing", async () => {
		const catalogued = sim().device("vent", "StructureActiveVent", {}, { custom: true }).build();
		await expect(catalogued).rejects.toThrow(/"vent": StructureActiveVent is in the emulator's catalogue/);
		const housing = sim().housing("ic", { code: "yield", custom: true }).build();
		await expect(housing).rejects.toThrow(/housing "ic": a housing can't be custom/);
	});

	it("must be on the housing's network to be pinned", async () => {
		const build = sim()
			.network("a")
			.network("b")
			.device("dial", "ModularDeviceDial", {}, { custom: true, network: "b" })
			.housing("ic", { code: "yield", network: "a", pins: { d0: "dial" } })
			.build();
		await expect(build).rejects.toThrow(/"ic" d0: "dial" is on network "b", not "a"/);
	});
});
