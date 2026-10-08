import type { World } from "./world.ts";

/** A scripted change to the world. It may be async; whatever it returns is otherwise ignored. */
export type WorldEvent = (world: World) => unknown;

/** A point in game time: a tick number, or seconds (rounded up to a whole tick). */
export type When = { tick: number } | { seconds: number };

/** An interval: a number of ticks, or seconds (rounded up to whole ticks). */
export type Interval = { ticks: number } | { seconds: number };

/** Stops a scheduled event from firing again. */
export type Cancel = () => void;

interface Entry {
	/** Whether this entry fires at the start of `tick`. Updates its own state. */
	due(tick: number, world: World): Promise<boolean> | boolean;
	run: WorldEvent;
	/** Whether the entry may still fire without anything changing the world (for idle detection). */
	pending(tick: number): boolean;
}

/**
 * Scripted events. They run at the start of a tick, before any chip, in the order they were
 * added, so the world can change between any two ticks as it can in game.
 */
export class EventQueue {
	private entries: Entry[] = [];

	private add(entry: Entry): Cancel {
		this.entries.push(entry);
		return () => {
			this.entries = this.entries.filter((e) => e !== entry);
		};
	}

	/** Fire once at the start of `tick`. */
	at(tick: number, run: WorldEvent): Cancel {
		return this.add({ due: (t) => t === tick, run, pending: (t) => t <= tick });
	}

	/** Fire at the start of `first`, then every `ticks` ticks after it. */
	every(ticks: number, first: number, run: WorldEvent): Cancel {
		if (!(Number.isInteger(ticks) && ticks > 0)) throw new Error(`every: interval must be at least 1 tick (got ${ticks})`);
		return this.add({ due: (t) => t >= first && (t - first) % ticks === 0, run, pending: () => true });
	}

	/**
	 * Fire whenever `condition` becomes true: it's checked at the start of each tick, and fires on
	 * the first tick it holds, then again only after it has been false.
	 */
	when(condition: (world: World) => boolean | Promise<boolean>, run: WorldEvent): Cancel {
		let held = false;
		return this.add({
			due: async (_t, world) => {
				const now = await condition(world);
				const fire = now && !held;
				held = now;
				return fire;
			},
			run,
			pending: () => false,
		});
	}

	/** Run every event due at the start of `tick`. */
	async fire(tick: number, world: World): Promise<void> {
		for (const entry of [...this.entries]) {
			if (await entry.due(tick, world)) await entry.run(world);
		}
	}

	/** Whether an `at` or `every` event is still to come at or after `tick`. */
	pending(tick: number): boolean {
		return this.entries.some((e) => e.pending(tick));
	}
}
