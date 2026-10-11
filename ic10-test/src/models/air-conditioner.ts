import { ONE_ATMOSPHERE } from "../atmos/gases.ts";
import { Mixture } from "../atmos/mixture.ts";
import type { DeviceModel } from "../world/models.ts";
import { clamp, DEFAULT_PRESSURE_PER_TICK, gameTicks, molesFor, parcelMoles, requirePorts } from "./flow.ts";

/** The litres of input gas the unit works on each tick, at `pressurePerTick` (the game's figure). */
const PROCESS_VOLUME = 100;
/** The most heat the unit moves in a tick, in joules, before its efficiencies (the game's figure). */
const ENERGY_PER_TICK = 14000;

export interface AirConditionerOptions {
	/**
	 * How much input gas passes through each tick, as kPa of 100 L at the input's temperature. The
	 * prefab's value is in the game's asset files, so this defaults to the code's 101.325 (about 4 mol
	 * a tick at 300 K).
	 */
	pressurePerTick?: number;
	/**
	 * The Temperature Differential Efficiency, 0 to 1, from how far the unit pumps heat uphill: the
	 * waste's temperature above the gas's when cooling, below it when heating (negative when heat
	 * flows downhill). The game's curve is in its asset files; the default is a guess: 1 up to 0 K,
	 * falling in a straight line to 0 at 200 K.
	 */
	temperatureDifferentialEfficiency?: (kelvinUphill: number) => number;
	/**
	 * The Operational Temperature Efficiency, 0 to 1, from a temperature: the lower of the gas's and
	 * the waste's counts. The game's curve is in its asset files; the default is a guess of 1.
	 */
	operationalTemperatureEfficiency?: (kelvin: number) => number;
}

/**
 * An Air Conditioner (`StructureAirConditioner`), following the game's `AirConditioner`. Attach it
 * with `{ ports: { input, output, output2 } }` (`output2` is its waste). While `On` with `Mode` 1,
 * and the input at least 1 K from `Setting` (the goal, in kelvin), each tick it takes some input
 * gas, moves heat between that gas and the waste pipe (up to 14 kJ, scaled by its three
 * efficiencies), and sends the gas to `output`. Otherwise no gas passes. As in the game's code,
 * nothing stops a small amount of gas overshooting the goal.
 *
 * It sets `TemperatureDifferentialEfficiency`, `OperationalTemperatureEfficiency` and
 * `PressureEfficiency` (0 to 1) while it works. Pressure Efficiency is the game's: full with both
 * the input and the waste at 111 kPa or more, none at 10 kPa or less.
 */
export function airConditioner(options: AirConditionerOptions = {}): DeviceModel {
	const pressurePerTick = options.pressurePerTick ?? DEFAULT_PRESSURE_PER_TICK;
	const differential = options.temperatureDifferentialEfficiency ?? ((uphill: number) => clamp(1 - uphill / 200, 0, 1));
	const operational = options.operationalTemperatureEfficiency ?? (() => 1);
	return (ac, dt) => {
		const [input, output, waste] = requirePorts(ac, "air conditioner", ["input", "output", "output2"] as const);
		if (ac.get("On") !== 1 || ac.get("Mode") !== 1) return;
		const goal = ac.get("Setting");
		if (Math.abs(goal - input.temperature) < 1) return;

		const pressureEfficiency = clamp(Math.min(input.pressure, waste.pressure) / ONE_ATMOSPHERE - 0.1, 0, 1);
		const ticks = gameTicks(dt);
		const parcel = input.take(molesFor(pressurePerTick, PROCESS_VOLUME, input.temperature) * ticks);
		if (parcelMoles(parcel) === 0) return;
		const gas = new Mixture({ volume: PROCESS_VOLUME, temperature: parcel.temperature, gases: parcel.gases });

		const heating = goal > gas.temperature;
		const uphill = heating ? gas.temperature - waste.temperature : waste.temperature - gas.temperature;
		const differentialEfficiency = clamp(differential(uphill), 0, 1);
		const operationalEfficiency = clamp(Math.min(operational(gas.temperature), operational(waste.temperature)), 0, 1);
		const energy = ENERGY_PER_TICK * differentialEfficiency * operationalEfficiency * pressureEfficiency * ticks;

		// Heat can't be taken below 0 K, so the side giving it caps what moves.
		const [from, to] = heating ? [waste, gas] : [gas, waste];
		const moved = Math.min(energy, from.heatCapacity * from.temperature);
		from.addHeat(-moved);
		to.addHeat(moved);
		output.merge({ gases: gas.gases(), temperature: gas.temperature });

		ac.set("TemperatureDifferentialEfficiency", differentialEfficiency);
		ac.set("OperationalTemperatureEfficiency", operationalEfficiency);
		ac.set("PressureEfficiency", pressureEfficiency);
	};
}
