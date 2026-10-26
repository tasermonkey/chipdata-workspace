import { describe, expect, it } from "vitest";
import { hash, type World } from "@tasermonkey/ic10-bench";
import { readRepoScript } from "../../support/paths.ts";
import { build, rack, type RackSetup } from "./rack.ts";
import { COUNT, RECIPES, ROW, recipeCells } from "./recipes.ts";

const SCRIPT = "ic10/DS8/FurnaceControl/Furnace Recipes Setup.ic10";
const HASH_IC = "ic10/FurnaceControl/AdvFurnaceControl/Hash.ic10";

const fit = (setup: RackSetup = {}) => build({ recipes: false, ...setup, chips: ["setup"] });

/** The `done:` loop's lines (its label, `yield`, `j done`), 0-based as the chip counts them. */
const DONE = readRepoScript(SCRIPT).split("\n").indexOf("done:");
const done = (world: World) => world.chip("setup").line >= DONE && world.chip("setup").line <= DONE + 2;

/** Every cell the recipes take, as the drive has them. */
function drive(world: World): Record<number, number> {
	const cells: Record<number, number> = { [COUNT]: rack(world).memory(COUNT) };
	for (let n = 1; n <= RECIPES.length; n++) {
		for (let field = 0; field < 6; field++) cells[n * ROW + field] = rack(world).memory(n * ROW + field);
	}
	return cells;
}

describe("Furnace Recipes Setup (DS-8)", () => {
	it("writes every recipe to the drive in bay 1, then parks at done", async () => {
		expect(DONE).toBeGreaterThan(0);
		const world = await fit();
		await world.runUntil(done, { maxTicks: 40 });
		expect(drive(world)).toEqual(recipeCells());
		expect(world.chip("setup")).toHaveNoErrors();

		const line = world.chip("setup").line;
		await world.runTicks(10);
		expect(world.chip("setup").line).toBe(line); // still parked
	});

	it("keeps trying until there's a drive in bay 1", async () => {
		const world = await fit({ rack: { drives: [2] } });
		await world.runTicks(60);
		expect(done(world)).toBe(false);
		expect(world.chip("setup")).toHaveNoErrors();

		rack(world).insertDrive(1);
		await world.runUntil(done, { maxTicks: 60 });
		expect(drive(world)).toEqual(recipeCells());
	});

	it("keeps trying until MEM WR is on", async () => {
		const world = await fit({ rack: { switches: { memWrite: false } } });
		await world.runTicks(60);
		expect(done(world)).toBe(false);
		expect(rack(world).memory(COUNT)).toBe(0);

		rack(world).setSwitch("memWrite", true);
		await world.runUntil(done, { maxTicks: 60 });
		expect(drive(world)).toEqual(recipeCells());
	});

	it("keeps a larger recipe count already on the drive", async () => {
		const world = await fit({ rack: { memory: { [COUNT]: 20 } } });
		await world.runUntil(done, { maxTicks: 40 });
		expect(rack(world).memory(COUNT)).toBe(20);
	});

	it("keeps the count off drive cell 0, where the rack's Network program stores an ID on F1", () => {
		expect(COUNT).not.toBe(0);
		expect(Object.keys(recipeCells()).map(Number)).not.toContain(0);
	});

	it("is fully written: its recipes match AdvFurnaceControl's Hash.ic10, digit for digit", () => {
		// Hash.ic10: `s db Setting <ingot hash>` then `move r2 0.<four 5-digit fields>`, one per dial step
		const hashIc = readRepoScript(HASH_IC);
		const blocks = [...hashIc.matchAll(/s db Setting (-?\d+)[^\n]*\nmove r2 0\.(\d{20})/g)];
		expect(blocks).toHaveLength(RECIPES.length);
		blocks.forEach(([, ingotHash, digits], i) => {
			const [minK, maxK, minKpa, maxKpa] = [0, 5, 10, 15].map((at) => Number(digits.slice(at, at + 5)));
			const dial = i + 1;
			// Hash.ic10's Amount multiplier; the furnace counted a super-alloy's Reagents ÷ 4
			const perStep = (dial <= 7 ? 50 : dial === 8 ? 200 : dial <= 12 ? 100 : 50) * (dial >= 13 ? 4 : 1);
			const r = RECIPES[i];
			expect({ hash: hash(r.ingot), minK: r.minK, maxK: r.maxK, minKpa: r.minKpa, maxKpa: r.maxKpa, perStep: r.perStep }, r.ingot).toEqual({
				hash: Number(ingotHash),
				minK,
				maxK,
				minKpa,
				maxKpa,
				perStep,
			});
		});
	});

	it("names each ingot by HASH(), as the game's prefab names", () => {
		const names = [...readRepoScript(SCRIPT).matchAll(/tmjc r0 recipe HASH\("(\w+)"\)/g)].map(([, name]) => name);
		expect(names).toEqual(RECIPES.map((r) => r.ingot));
	});
});
