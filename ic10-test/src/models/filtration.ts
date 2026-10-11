import { type GasAmounts, type GasName, isGasName, PIPE_VOLUME } from "../atmos/gases.ts";
import type { GasParcel } from "../atmos/mixture.ts";
import { hash } from "../engine/device.ts";
import type { DeviceModel } from "../world/models.ts";
import type { DeviceHandle } from "../world/world.ts";
import { DEFAULT_PRESSURE_PER_TICK, gameTicks, MAX_PIPE_PRESSURE, molesFor, parcelMoles, requirePorts } from "./flow.ts";

/** Below this share of the input, a filter takes all that's left of its gas (the game's figure). */
const MINIMUM_RATIO_TO_FILTER_ALL = 0.001;

/** Each gas filter item's name (`ItemGasFilter<name>`, plus `L`, `M`, `Infinite`) and its gas. */
const FILTER_GASES: Record<string, GasName> = {
	Alcohol: "LiquidAlcohol",
	CarbonDioxide: "CarbonDioxide",
	HCl: "HydrochloricAcid",
	Helium: "Helium",
	Hydrazine: "Hydrazine",
	Hydrogen: "Hydrogen",
	Nitrogen: "Nitrogen",
	NitrousOxide: "NitrousOxide",
	Oxygen: "Oxygen",
	Ozone: "Ozone",
	Pollutants: "Pollutant",
	PollutedWater: "PollutedWater",
	Salt: "LiquidSodiumChloride",
	Silanol: "Silanol",
	Volatiles: "Methane",
	Water: "Steam",
};

/** Filter items by their `OccupantHash`. */
const FILTERS_BY_HASH = new Map<number, GasName>(
	Object.entries(FILTER_GASES).flatMap(([name, gas]) =>
		["", "L", "M", "Infinite"].map((size) => [hash(`ItemGasFilter${name}${size}`), gas] as const),
	),
);

export interface FiltrationOptions {
	/**
	 * The least the unit draws from its input in a tick, as kPa of one pipe segment (10 L); it draws
	 * more the higher the input is above both outputs. The prefab's value is in the game's asset
	 * files, so this defaults to the code's 101.325.
	 */
	pressurePerTick?: number;
	/** The gases it filters. Without this, it reads the gas filters in its two filter slots. */
	gases?: GasName[];
}

/**
 * A Filtration unit (`StructureFiltration`), following the game's `FiltrationMachineBase`. Attach
 * it with `{ ports: { input, output, output2 } }`: `output` is the game's filter output and
 * `output2` its waste. While `On` with `Mode` 1 (the unit's own button sets Mode in game), each
 * tick it draws gas from the input, sends the filtered gases (and their liquid forms) to `output`
 * and the rest to `output2`. Filters don't wear out.
 */
export function filtration(options: FiltrationOptions = {}): DeviceModel {
	const pressurePerTick = options.pressurePerTick ?? DEFAULT_PRESSURE_PER_TICK;
	for (const gas of options.gases ?? []) {
		if (!isGasName(gas)) throw new Error(`filtration: no gas "${gas}"`);
	}
	return (unit, dt) => {
		const [input, output, waste] = requirePorts(unit, "filtration unit", ["input", "output", "output2"] as const);
		if (unit.get("On") !== 1 || unit.get("Mode") === 0) return;

		// The game's `AtmosphereHelper.TakeNormalisedGasPressureScaled`.
		const lift = Math.max(input.pressure - Math.max(output.pressure, waste.pressure), 0);
		const kPa = pressurePerTick + (lift * (MAX_PIPE_PRESSURE / 3 - pressurePerTick)) / MAX_PIPE_PRESSURE;
		const parcel = input.take(molesFor(kPa, PIPE_VOLUME, input.temperature) * gameTicks(dt));
		if (parcelMoles(parcel) === 0) return;

		const filtered: GasParcel = { gases: {}, temperature: parcel.temperature };
		for (const gas of (options.gases ?? slotFilters(unit)).flatMap(withLiquid)) {
			moveGas(parcel.gases, filtered.gases, gas);
			// A trace left in the input goes too, as the game's filter cleans out the last of it.
			if (input.moles(gas) > 0 && input.ratio(gas) < MINIMUM_RATIO_TO_FILTER_ALL) {
				output.merge(input.takeGas(gas, Infinity));
			}
		}
		output.merge(filtered);
		waste.merge(parcel);
	};
}

/** The gases of the unfinished filters in slots 0 and 1. */
function slotFilters(unit: DeviceHandle): GasName[] {
	const gases: GasName[] = [];
	for (const index of [0, 1]) {
		const slot = unit.slot(index);
		if (!slot.occupied || !(slot.get("Quantity") > 0)) continue;
		const gas = FILTERS_BY_HASH.get(slot.get("OccupantHash"));
		if (gas) gases.push(gas);
	}
	return gases;
}

/** A gas and its other phase (the game's `CondensationType`): Oxygen and LiquidOxygen, Steam and Water. */
function withLiquid(gas: GasName): GasName[] {
	if (gas === "Steam") return ["Steam", "Water"];
	if (gas === "Water") return ["Water", "Steam"];
	const other = gas.startsWith("Liquid") ? gas.slice("Liquid".length) : `Liquid${gas}`;
	return isGasName(other) ? [gas, other] : [gas];
}

function moveGas(from: GasAmounts, to: GasAmounts, gas: GasName) {
	const n = from[gas];
	if (!n) return;
	to[gas] = (to[gas] ?? 0) + n;
	delete from[gas];
}
