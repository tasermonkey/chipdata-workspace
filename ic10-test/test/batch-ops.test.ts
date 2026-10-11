import { describe, expect, it } from "vitest";
import type { CatalogPrefab } from "../src/catalog/catalog.ts";
import { hash } from "../src/engine/device.ts";
import { checkBatchOps } from "../src/lint/batch-ops.ts";

const prefab = (name: string, logic: CatalogPrefab["logic"], slots: CatalogPrefab["slots"] = []): CatalogPrefab => ({
	prefab: name,
	hash: hash(name),
	title: name,
	logic,
	slots,
	modes: [],
	source: "game",
});

const CATALOG = {
	prefabs: {
		StructureActiveVent: prefab("StructureActiveVent", { Mode: "rw", PressureOutput: "r", Lock: "w" }),
		StructureLogicDial: prefab("StructureLogicDial", { Setting: "rw" }),
		StructureBattery: prefab("StructureBattery", { Charge: "r" }, [{ index: 0, name: "", type: "Battery", logic: ["Occupied", "Charge"] }]),
		StructureSorter: prefab("StructureSorter", { On: "rw" }, [{ index: 0, name: "Import", type: "None", logic: ["Occupied", "Quantity"] }]),
	},
};

const check = (source: string) => checkBatchOps(source, CATALOG).map((f) => [f.line, f.problem, f.message]);

describe("checkBatchOps", () => {
	it("passes properties the prefab has, with the access the instruction needs", () => {
		expect(
			check(`define VENT HASH("StructureActiveVent")
lb r0 VENT PressureOutput Average
sbn VENT HASH("Vent 1") Mode 1
lbs r1 HASH("StructureBattery") 0 Charge Sum`),
		).toEqual([]);
	});

	it("reports a property the prefab doesn't have", () => {
		expect(check('lbn r0 HASH("StructureActiveVent") HASH("Vent 1") Setting Maximum')).toEqual([
			[0, "no-such-property", "StructureActiveVent has no Setting"],
		]);
	});

	it("reports reading a write-only property and writing a read-only one", () => {
		expect(check('lb r0 HASH("StructureActiveVent") Lock Average\nsb HASH("StructureActiveVent") PressureOutput 5')).toEqual([
			[0, "not-readable", "StructureActiveVent.Lock can't be read"],
			[1, "not-writable", "StructureActiveVent.PressureOutput is read-only"],
		]);
	});

	it("follows defines, including ones after the line and ones holding a hash as a number", () => {
		expect(check(`lb r0 DIAL Charge Average\ndefine DIAL ${hash("StructureLogicDial")}`)).toEqual([
			[0, "no-such-property", "StructureLogicDial has no Charge"],
		]);
		expect(check(`define T VENT\ndefine VENT HASH("StructureActiveVent")\nsb T Charge 1`)).toEqual([
			[2, "no-such-property", "StructureActiveVent has no Charge"],
		]);
	});

	it("checks slot logic types against the prefab's slots", () => {
		expect(check('lbs r0 HASH("StructureBattery") 0 Quantity Sum\nlbs r0 HASH("StructureBattery") 3 Charge Sum')).toEqual([
			[0, "no-such-slot-property", "StructureBattery has no Quantity in slot 0"],
			[1, "no-such-slot-property", "StructureBattery has no Charge in slot 3"],
		]);
	});

	it("reports a HASH() of a prefab it doesn't know", () => {
		expect(check('sb HASH("StructureActivVent") On 1')).toEqual([[0, "unknown-prefab", "no prefab StructureActivVent in the catalogue"]]);
	});

	it("skips what it can't know without running: a type in a register, a number that isn't a prefab hash", () => {
		expect(check("alias Prefab r5\nlbn r0 Prefab HASH(\"x\") Charge Average\nsb 12345 Charge 1")).toEqual([]);
	});

	it("ignores comments, and HASH() names holding spaces or #", () => {
		expect(check('sbn HASH("StructureActiveVent") HASH("Vent #1 A") Mode 1 # sb HASH("StructureActiveVent") Charge 1')).toEqual([]);
	});
});
