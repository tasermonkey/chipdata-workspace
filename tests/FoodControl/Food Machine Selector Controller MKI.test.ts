import { describe, expect, it } from "vitest";
import { hash, sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

const EQUALS = 1; // sorter instruction: PrefabHashEquals
const NOT_EQUALS = 2; // NotPrefabHashEquals

/** The sorter's instruction for an item: its hash shifted up 8 bits, with the operation below. */
const instruction = (item: string, op: number) => hash(item) * 256 + op;

function build({ dial, lever = 0 }: { dial: number; lever?: number }) {
	return sim({ root: REPO_ROOT })
		.device("sorter", "StructureLogicSorter")
		.device("button", "StructureLogicButton")
		.device("dial", "StructureLogicDial", { Setting: dial })
		.device("memory", "StructureLogicMemory")
		.device("lever", "StructureLogicSwitch", { Setting: lever })
		.device("flipFlop", "StructureChuteDigitalFlipFlopSplitterLeft")
		.device("count", "StructureConsoleLED5", {}, { name: "LED Count" })
		.housing("ic", {
			file: "ic10/FoodControl/Food Machine Selector Controller MKI.ic10",
			pins: { d0: "sorter", d1: "button", d2: "dial", d3: "memory", d4: "lever", d5: "flipFlop" },
		})
		.build();
}

async function press(world: World) {
	world.device("button").set("Activate", 1);
	await world.runTicks(1);
	world.device("button").set("Activate", 0);
	await world.runTicks(1);
}

describe("Food Machine Selector Controller MKI", () => {
	it("shows the dialled item's hash in the memory before the button is pressed", async () => {
		const world = await build({ dial: 1 });
		await world.runTicks(2);
		expect(world.device("memory")).toHaveProps({ Setting: hash("ItemPotato") });
		expect(world.device("sorter").stackAt(0)).toBe(0); // nothing sent yet
	});

	it("on a press, sends wheat (dial 0) one way: sort everything but wheat", async () => {
		const world = await build({ dial: 0 });
		await world.runTicks(1);
		await press(world);

		expect(world.device("sorter")).toHaveProps({ Mode: 1 });
		expect(world.device("sorter").stackAt(0)).toBe(instruction("ItemWheat", NOT_EQUALS));
		expect(world.device("flipFlop")).toHaveProps({ Mode: 0, Setting: 0 });
		expect(world.device("count")).toHaveProps({ Setting: 0 });
		expect(world.chip("ic")).toHaveNoErrors();
	});

	it("on a press, sends potatoes (dial 1) the other way: sort only potatoes", async () => {
		const world = await build({ dial: 1 });
		await world.runTicks(1);
		await press(world);

		expect(world.device("sorter").stackAt(0)).toBe(instruction("ItemPotato", EQUALS));
		expect(world.device("flipFlop")).toHaveProps({ Mode: 1 });
		expect(world.device("count")).toHaveProps({ Setting: 1 });
	});

	it("for soybeans (dial 2), takes the direction from the lever", async () => {
		for (const lever of [0, 1]) {
			const world = await build({ dial: 2, lever });
			await world.runTicks(1);
			await press(world);

			expect(world.device("sorter").stackAt(0)).toBe(instruction("ItemSoybean", lever ? EQUALS : NOT_EQUALS));
			expect(world.device("flipFlop")).toHaveProps({ Mode: lever });
		}
	});

	it.todo("CODE_REVIEW.md 2.8: a dial setting of 3 or more doesn't read past the item table");
});
