/**
 * The Advanced Furnace's recipes, as AdvFurnaceControl's README has them (exact: its Hash.ic10
 * packs them into one number, which loses some of the last field), and where they sit on the drive.
 */
import { hash } from "@tasermonkey/ic10-bench";
import { readRepoScript } from "../../support/paths.ts";

export interface Recipe {
	/** The ingot's prefab name. */
	ingot: string;
	minK: number;
	maxK: number;
	minKpa: number;
	maxKpa: number;
	/** The furnace's Reagents for each step of the Amount dial. */
	perStep: number;
}

const basic = (ingot: string, minKpa = 1000): Recipe => ({ ingot, minK: 950, maxK: 10000, minKpa, maxKpa: 10000, perStep: 50 });

/** By recipe number - 1: the Ingot Dial's order. */
export const RECIPES: readonly Recipe[] = [
	basic("ItemIronIngot", 100),
	basic("ItemCopperIngot"),
	basic("ItemGoldIngot"),
	basic("ItemSiliconIngot"),
	basic("ItemSilverIngot"),
	basic("ItemLeadIngot"),
	basic("ItemNickelIngot"),
	{ ingot: "ItemSteelIngot", minK: 900, maxK: 10000, minKpa: 1000, maxKpa: 10000, perStep: 200 },
	{ ingot: "ItemInvarIngot", minK: 1200, maxK: 1500, minKpa: 18000, maxKpa: 20000, perStep: 100 },
	{ ingot: "ItemSolderIngot", minK: 350, maxK: 550, minKpa: 1000, maxKpa: 10000, perStep: 100 },
	{ ingot: "ItemElectrumIngot", minK: 600, maxK: 10000, minKpa: 800, maxKpa: 2350, perStep: 100 },
	{ ingot: "ItemConstantanIngot", minK: 1000, maxK: 10000, minKpa: 20000, maxKpa: 55000, perStep: 100 },
	{ ingot: "ItemWaspaloyIngot", minK: 400, maxK: 800, minKpa: 50000, maxKpa: 55000, perStep: 200 },
	{ ingot: "ItemInconelIngot", minK: 600, maxK: 10000, minKpa: 23500, maxKpa: 23800, perStep: 200 },
	{ ingot: "ItemAstroloyIngot", minK: 1000, maxK: 10000, minKpa: 30000, maxKpa: 40000, perStep: 200 },
	{ ingot: "ItemHastelloyIngot", minK: 950, maxK: 1000, minKpa: 25000, maxKpa: 30000, perStep: 200 },
	{ ingot: "ItemStelliteIngot", minK: 1800, maxK: 10000, minKpa: 10000, maxKpa: 19500, perStep: 200 },
];

/** Recipe n (1-based) starts at drive cell n × ROW. */
export const ROW = 8;

/** The drive cell with how many recipes there are, as Furnace Control has it. */
export const COUNT = Number(
	/^define COUNT (\d+)/m.exec(readRepoScript("ic10/DS8/FurnaceControl/Furnace Control.ic10"))?.[1] ?? Number.NaN,
);

/** A recipe's cells, in order from n × ROW. */
export function recipeRow(recipe: Recipe): number[] {
	return [hash(recipe.ingot), recipe.minK, recipe.maxK, recipe.minKpa, recipe.maxKpa, recipe.perStep];
}

/** The drive's cells with every recipe on it, as the setup chip leaves it. */
export function recipeCells(recipes: readonly Recipe[] = RECIPES): Record<number, number> {
	const cells: Record<number, number> = { [COUNT]: recipes.length };
	recipes.forEach((recipe, i) => {
		recipeRow(recipe).forEach((value, field) => {
			cells[(i + 1) * ROW + field] = value;
		});
	});
	return cells;
}

/** The recipe with this ingot, and its number. */
export function recipe(ingot: string): { number: number; recipe: Recipe } {
	const index = RECIPES.findIndex((r) => r.ingot === ingot);
	if (index < 0) throw new Error(`no recipe for ${ingot}`);
	return { number: index + 1, recipe: RECIPES[index] };
}
