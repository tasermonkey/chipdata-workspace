/**
 * Shared by the Advanced Furnace Control tests (Hash and Adv Furnace), whose two chips talk
 * through each other's housing Setting.
 */
import type { HousingOptions } from "@tasermonkey/ic10-bench";

/**
 * Iron, as Hash lists it: its ingot dial position, the recipe hash, and the min/max temperature
 * and pressure packed in one number that it hands to the Furnace IC.
 */
export const IRON = { dial: 1, hash: -1301215609, limits: 0.0095010000001001 };

/**
 * The other chip's compact housing, found by `name`, with a chip that does nothing: a test sets its
 * Setting by hand, or reads what the chip under test wrote there.
 */
export function standIn(name: string, props: { Setting?: number } = {}): HousingOptions<"StructureCircuitHousingCompact"> {
	return { code: "yield\nj 0", prefab: "StructureCircuitHousingCompact", name, props };
}
