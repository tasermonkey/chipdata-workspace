import { IDEAL_GAS_CONSTANT } from "../atmos/gases.ts";
import type { GasParcel, Mixture } from "../atmos/mixture.ts";
import type { Port } from "../world/atmospheres.ts";
import type { DeviceHandle } from "../world/world.ts";

/** The game's tick, which the models' per-tick rates are given for. */
export const GAME_TICK_SECONDS = 0.5;

/**
 * The game's code default for a device's `pressurePerTick` (`DeviceAtmospherics`). Each prefab
 * can override it in the asset files, which the harness can't read, so models start from this.
 */
export const DEFAULT_PRESSURE_PER_TICK = 101.325;

/** The game's highest pressure in a gas pipe (`Chemistry.Limits.MAXPressureGasPipe`), kPa. */
export const MAX_PIPE_PRESSURE = 60795;

/** How many game ticks `dt` seconds is: rates per tick are scaled by this. */
export function gameTicks(dt: number): number {
	return dt / GAME_TICK_SECONDS;
}

/** Moles that give `kPa` in `litres` at `kelvin` (0 if any is 0 or less). */
export function molesFor(kPa: number, litres: number, kelvin: number): number {
	if (!(kPa > 0) || !(litres > 0) || !(kelvin > 0)) return 0;
	return Number.isFinite(kPa) ? (kPa * litres) / (IDEAL_GAS_CONSTANT * kelvin) : Infinity;
}

export function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}

/** The total moles in a parcel. */
export function parcelMoles(parcel: GasParcel): number {
	let n = 0;
	for (const m of Object.values(parcel.gases)) n += m ?? 0;
	return n;
}

/**
 * The pipes on a device's ports, in the order asked for. Throws, naming the device and the ports
 * it needs, if any is missing.
 */
export function requirePorts<const P extends readonly Port[]>(device: DeviceHandle, kind: string, ports: P): { [K in keyof P]: Mixture } {
	const pipes = ports.map((port) => device.port(port));
	if (pipes.some((pipe) => !pipe)) {
		const wanted = ports.map((port) => `${port}: "<pipe>"`).join(", ");
		throw new Error(`${kind} "${device.key}" needs pipes on ${ports.join(", ")}: { ports: { ${wanted} } }`);
	}
	return pipes as { [K in keyof P]: Mixture };
}
