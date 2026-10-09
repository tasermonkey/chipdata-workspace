import { describe, expect, it } from "vitest";
import { hash, sim } from "../src/index.ts";

describe("device slots", () => {
	it("put an item where ls can read it, with Occupied, OccupantHash and Quantity", async () => {
		const world = await sim({ debug: false })
			.device("furnace", "StructureArcFurnace")
			.housing("ic", {
				code: "ls r0 d0 0 Occupied\nls r1 d0 0 OccupantHash\nls r2 d0 0 Quantity\nls r3 d0 1 Occupied\nyield",
				pins: { d0: "furnace" },
			})
			.build();
		world.device("furnace").slot(0).put("ItemIronOre", { Quantity: 12 });
		await world.runTicks(1);

		const ic = world.chip("ic");
		expect(ic).toHaveRegister("r0", 1);
		expect(ic).toHaveRegister("r1", hash("ItemIronOre"));
		expect(ic).toHaveRegister("r2", 12);
		expect(ic).toHaveRegister("r3", 0); // the export slot is empty
		expect(ic).toHaveNoErrors();
	});

	it("can be read, changed and emptied from the test", async () => {
		const world = await sim({ debug: false }).device("furnace", "StructureArcFurnace").housing("ic", { code: "yield" }).build();
		const slot = world.device("furnace").slot(0);
		expect(slot.occupied).toBe(false);
		expect(slot.get("Quantity")).toBe(0);

		slot.put("ItemIronOre");
		expect(slot.occupied).toBe(true);
		expect(slot.get("Quantity")).toBe(1);
		slot.set("Quantity", 5);
		expect(slot.get("Quantity")).toBe(5);

		slot.clear();
		expect(slot.occupied).toBe(false);
		expect(slot.get("Occupied")).toBe(0);
		expect(() => slot.set("Quantity", 1)).toThrow(/slot 0 is empty/);
	});

	it("are only the device's own slots", async () => {
		const world = await sim({ debug: false }).device("furnace", "StructureArcFurnace").housing("ic", { code: "yield" }).build();
		expect(() => world.device("furnace").slot(7)).toThrow(/has no slot 7/);
	});
});

describe("hash()", () => {
	it("matches the game's HASH()", async () => {
		const world = await sim({ debug: false }).housing("ic", { code: 'move r0 HASH("ItemWheat")\nyield' }).build();
		await world.runTicks(1);
		expect(world.chip("ic")).toHaveRegister("r0", hash("ItemWheat"));
	});
});
