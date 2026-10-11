import { IDEAL_GAS_CONSTANT, PIPE_VOLUME } from "../atmos/gases.ts";
import type { DeviceModel } from "../world/models.ts";
import { clamp, DEFAULT_PRESSURE_PER_TICK, gameTicks, molesFor, requirePorts } from "./flow.ts";

export interface VolumePumpOptions {
	/** The highest `Setting` the pump acts on, in litres per tick. The game's code default is 10. */
	maxSetting?: number;
}

/**
 * A Volume Pump (`StructureVolumePump`), following the game's `VolumePump`. Attach it with
 * `{ ports: { input, output } }`. While `On`, each tick it moves `Setting` litres of the input
 * pipe's gas to the output: that share of the input's moles, whatever the output's pressure.
 * Liquids move with the gas, unlike in game.
 */
export function volumePump(options: VolumePumpOptions = {}): DeviceModel {
	const maxSetting = options.maxSetting ?? 10;
	return (pump, dt) => {
		const [input, output] = requirePorts(pump, "volume pump", ["input", "output"] as const);
		if (pump.get("On") !== 1) return;
		const share = clamp(pump.get("Setting"), 0, maxSetting) / input.volume;
		// Compounded per game tick, so a different tick length moves the same gas over time.
		const moved = 1 - (1 - Math.min(share, 1)) ** gameTicks(dt);
		output.merge(input.take(input.totalMoles * moved));
	};
}

export interface RegulatorOptions {
	/**
	 * The least a regulator moves in a tick, as kPa of one pipe segment (10 L) at the input's
	 * temperature; with the input at higher pressure it moves at least a quarter of what would even
	 * the two pipes out. The prefab's value is in the game's asset files, so this defaults to the
	 * code's 101.325.
	 */
	pressurePerTick?: number;
}

/**
 * A Pressure Regulator (`StructurePressureRegulator`), following the game's `PressureRegulator`.
 * Attach it with `{ ports: { input, output } }`. While `On`, it moves gas from input to output
 * until the output reaches `Setting` kPa, pumping uphill if it has to.
 */
export function pressureRegulator(options: RegulatorOptions = {}): DeviceModel {
	return regulator("pressure regulator", "output", options);
}

/**
 * A Back Pressure Regulator (`StructureBackPressureRegulator`): as a pressure regulator, but it
 * moves gas while the input is above `Setting` kPa, down to that pressure.
 */
export function backPressureRegulator(options: RegulatorOptions = {}): DeviceModel {
	return regulator("back pressure regulator", "input", options);
}

function regulator(kind: string, watches: "input" | "output", options: RegulatorOptions): DeviceModel {
	const pressurePerTick = options.pressurePerTick ?? DEFAULT_PRESSURE_PER_TICK;
	return (device, dt) => {
		const [input, output] = requirePorts(device, kind, ["input", "output"] as const);
		if (device.get("On") !== 1) return;
		const setting = device.get("Setting");
		const kelvin = input.temperature;

		// The game's `AtmosphereHelper.MoveRegulatedGas`.
		let limit = molesFor(pressurePerTick, PIPE_VOLUME, kelvin);
		if (input.pressure > output.pressure) {
			const perMole = IDEAL_GAS_CONSTANT * kelvin * (1 / input.volume + 1 / output.volume);
			limit = Math.max((input.pressure - output.pressure) / perMole / 4, limit);
		}
		limit *= gameTicks(dt);
		const wanted =
			watches === "output"
				? molesFor(setting - output.pressure, output.volume, kelvin)
				: molesFor(input.pressure - setting, input.volume, kelvin);
		const moles = Math.min(wanted, limit);
		if (moles > 0) output.merge(input.take(moles));
	};
}
