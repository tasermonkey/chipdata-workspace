import type { DeviceModel } from "../world/models.ts";
import type { World } from "../world/world.ts";
import { clamp, gameTicks } from "./flow.ts";

/** Station batteries' capacity in joules, from their Stationpedia pages. */
const CAPACITY: Record<string, number> = {
	StructureBattery: 3_600_000,
	StructureBatteryLarge: 9_000_001,
};

/**
 * Power in watts, read each tick: a number; a device key (its `PowerGeneration` for generation, its
 * `RequiredPower` for usage); a `"key.Prop"` path, as `world.value` reads; a list of either, summed;
 * or a function of the world.
 */
export type PowerSource = number | string | readonly string[] | ((world: World) => number);

export interface BatteryOptions {
	/** What charges it: the generators on its input network. */
	generation?: PowerSource;
	/** What it supplies: the devices on its output network. */
	usage?: PowerSource;
	/** Joules it holds when full, if the device's `Maximum` isn't set and its prefab isn't known. */
	capacity?: number;
	/** Joules it loses each tick on its own. The game's figure is 10 (50 in a vacuum). */
	lossPerTick?: number;
}

/**
 * A station battery (`StructureBattery`, `StructureBatteryLarge`, …), following the game's
 * `Battery`. While `On`, each tick it takes in its generation and supplies its usage, as far as its
 * charge allows; a watt counts as a joule per tick, as the game's power ticks do. It sets `Charge`
 * (joules), `Maximum`, `Ratio`, `PowerPotential` (its charge), `PowerActual` (what it supplied) and
 * `Mode`, the game's charge state: 0 empty, 1 critical (above 0), 2 very low (0.1), 3 low (0.25),
 * 4 medium (0.5), 5 high (0.75), 6 full (0.999). A short supply doesn't brown anything out.
 */
export function battery(options: BatteryOptions = {}): DeviceModel {
	const lossPerTick = options.lossPerTick ?? 10;
	return (device, dt, world) => {
		const maximum = device.get("Maximum") || options.capacity || CAPACITY[device.prefab];
		if (!maximum) {
			throw new Error(`battery "${device.key}" needs a capacity: set its Maximum, or pass battery({ capacity })`);
		}
		const ticks = gameTicks(dt);
		let charge = clamp(device.get("Charge"), 0, maximum);
		let supplied = 0;
		if (device.get("On") === 1) {
			charge = Math.min(charge + power(options.generation, "PowerGeneration", world) * ticks, maximum);
			supplied = Math.min(power(options.usage, "RequiredPower", world) * ticks, charge);
			charge -= supplied;
		}
		charge = Math.max(charge - lossPerTick * ticks, 0);

		const ratio = charge / maximum;
		device.set("Charge", charge).set("Maximum", maximum).set("Ratio", ratio).set("Mode", chargeState(ratio));
		device.set("PowerPotential", charge).set("PowerActual", ticks > 0 ? supplied / ticks : 0);
	};
}

function power(source: PowerSource | undefined, prop: string, world: World): number {
	if (source === undefined) return 0;
	if (typeof source === "number") return source;
	if (typeof source === "function") return source(world);
	if (typeof source === "string") return world.value(source.includes(".") ? source : `${source}.${prop}`);
	return source.reduce((sum, one) => sum + power(one, prop, world), 0);
}

/** The game's `Battery` charge state, from the share of its capacity. */
function chargeState(ratio: number): number {
	if (ratio >= 0.999) return 6;
	if (ratio >= 0.75) return 5;
	if (ratio >= 0.5) return 4;
	if (ratio >= 0.25) return 3;
	if (ratio >= 0.1) return 2;
	return ratio > 0 ? 1 : 0;
}
