/**
 * The game's gases and constants, read from `Assembly-CSharp.dll` (game 0.2.6428.27798):
 * specific heats from `Chemistry.SpecificHeat`, the constants from `Chemistry`'s static fields,
 * and flags and names from the `GasType` enum. `Air` and `Fuel` are mixes, not gases, so they're
 * left out. A gas's name is also its logic type suffix: `Ratio${name}`, `Ratio${name}Input`, ….
 */

/** J/(mol·K). P [kPa] = n R T / V [L]. */
export const IDEAL_GAS_CONSTANT = 8.3144;
/** kPa. */
export const ONE_ATMOSPHERE = 101.325;
/** Litres in one pipe segment (gas). */
export const PIPE_VOLUME = 10;
/** Litres in one liquid pipe segment. */
export const LIQUID_PIPE_VOLUME = 20;
/** Litres in one grid cell (2 m × 2 m × 2 m), the unit a room is built from. */
export const GRID_VOLUME = 8000;

export interface GasInfo {
	name: string;
	/** The game's `GasType` flag. */
	flag: number;
	/** J/(mol·K). */
	specificHeat: number;
	/** Liquids count toward moles and ratios, but not pressure. */
	liquid: boolean;
}

/** In `GasType` order. */
export const GASES = [
	{ name: "Oxygen", flag: 1, specificHeat: 21.1, liquid: false },
	{ name: "Nitrogen", flag: 2, specificHeat: 20.6, liquid: false },
	{ name: "CarbonDioxide", flag: 4, specificHeat: 28.2, liquid: false },
	{ name: "Methane", flag: 8, specificHeat: 20.4, liquid: false },
	{ name: "Pollutant", flag: 16, specificHeat: 24.8, liquid: false },
	{ name: "Water", flag: 32, specificHeat: 72, liquid: true },
	{ name: "NitrousOxide", flag: 64, specificHeat: 37.2, liquid: false },
	{ name: "LiquidNitrogen", flag: 128, specificHeat: 20.6, liquid: true },
	{ name: "LiquidOxygen", flag: 256, specificHeat: 21.1, liquid: true },
	{ name: "LiquidMethane", flag: 512, specificHeat: 20.4, liquid: true },
	{ name: "Steam", flag: 1024, specificHeat: 72, liquid: false },
	{ name: "LiquidCarbonDioxide", flag: 2048, specificHeat: 28.2, liquid: true },
	{ name: "LiquidPollutant", flag: 4096, specificHeat: 24.8, liquid: true },
	{ name: "LiquidNitrousOxide", flag: 8192, specificHeat: 37.2, liquid: true },
	{ name: "Hydrogen", flag: 16384, specificHeat: 20.4, liquid: false },
	{ name: "LiquidHydrogen", flag: 32768, specificHeat: 20.4, liquid: true },
	{ name: "PollutedWater", flag: 65536, specificHeat: 72, liquid: true },
	{ name: "Hydrazine", flag: 131072, specificHeat: 48.4, liquid: false },
	{ name: "LiquidHydrazine", flag: 262144, specificHeat: 48.4, liquid: true },
	{ name: "LiquidAlcohol", flag: 524288, specificHeat: 33, liquid: true },
	{ name: "Helium", flag: 1048576, specificHeat: 20.8, liquid: false },
	{ name: "LiquidSodiumChloride", flag: 2097152, specificHeat: 130, liquid: true },
	{ name: "Silanol", flag: 4194304, specificHeat: 101, liquid: false },
	{ name: "LiquidSilanol", flag: 8388608, specificHeat: 101, liquid: true },
	{ name: "HydrochloricAcid", flag: 16777216, specificHeat: 37, liquid: false },
	{ name: "LiquidHydrochloricAcid", flag: 33554432, specificHeat: 37, liquid: true },
	{ name: "Ozone", flag: 67108864, specificHeat: 38.6, liquid: false },
	{ name: "LiquidOzone", flag: 134217728, specificHeat: 38.6, liquid: true },
] as const satisfies readonly GasInfo[];

export type GasName = (typeof GASES)[number]["name"];

/** Moles of each gas; gases left out have none. */
export type GasAmounts = Partial<Record<GasName, number>>;

const byName = new Map<string, GasInfo>(GASES.map((g) => [g.name, g]));

/** The gas called `name`, or an error listing the names. */
export function gasInfo(name: string): GasInfo {
	const info = byName.get(name);
	if (!info) throw new Error(`Unknown gas "${name}"; gases are ${GASES.map((g) => g.name).join(", ")}`);
	return info;
}

export function isGasName(name: string): name is GasName {
	return byName.has(name);
}
