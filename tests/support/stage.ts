/**
 * A staged script's current stage, and running until it reaches one. Most keep it in r15 (read as
 * r15, not by its alias: a predicate can run before the script has defined its aliases); a few keep
 * it in their housing's Setting.
 */
import type { World } from "@tasermonkey/ic10-bench";

/** Where a script keeps its stage. */
export type StageAt = (world: World) => number;

/** A chip's register, by default "ic"'s r15. */
export const inRegister =
	(chip = "ic", reg = "r15"): StageAt =>
	(world) =>
		world.chip(chip).reg(reg);

/** A housing's property, by default "ic"'s Setting. */
export const inHousing =
	(housing = "ic", prop = "Setting"): StageAt =>
	(world) =>
		world.db(housing).get(prop);

/** The script's stage now. */
export function stage(world: World, at: StageAt = inRegister()): number {
	return at(world);
}

/** Run until the script's stage is `n`; fails after `maxTicks` (default 20). */
export function reachStage(world: World, n: number, { at = inRegister(), maxTicks = 20 }: { at?: StageAt; maxTicks?: number } = {}) {
	return world.runUntil((w) => at(w) === n, { maxTicks });
}
