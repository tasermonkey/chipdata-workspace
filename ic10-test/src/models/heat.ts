import { exchangeHeat } from "../atmos/mixture.ts";
import type { WorldModel } from "../world/models.ts";

export interface HeatExchangeOptions {
	/**
	 * How far the two move toward a shared temperature each game tick (0.5 s), 0 to 1. A radiator's
	 * or heat exchanger's strength: tune it to how fast the build cools in game.
	 */
	fraction: number;
}

/**
 * Passive heat exchange between two pipes, or a pipe and a room, by key: radiators, or a heat
 * exchanger between a coolant pipe and a hot one. Energy is conserved; outside air doesn't warm.
 * Add it with `world.model(heatExchange("coolant", "waste", { fraction: 0.05 }))`.
 */
export function heatExchange(a: string, b: string, options: HeatExchangeOptions): WorldModel {
	const { fraction } = options;
	if (!(fraction >= 0 && fraction <= 1)) throw new Error(`heatExchange: fraction must be 0 to 1, got ${fraction}`);
	return (dt, world) => {
		// Compounded per game tick, so a different tick length gives the same cooling over time.
		const f = 1 - (1 - fraction) ** (dt / 0.5);
		exchangeHeat(world.atmosphere(a), world.atmosphere(b), f);
	};
}
