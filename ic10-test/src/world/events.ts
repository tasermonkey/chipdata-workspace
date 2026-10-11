import type { World } from "./world.ts";

/** A scripted change to the world. It may be async; whatever it returns is otherwise ignored. */
export type WorldEvent = (world: World) => unknown;

/** A point in game time: a tick number, or seconds (rounded up to a whole tick). */
export type When = { tick: number } | { seconds: number };

/** An interval: a number of ticks, or seconds (rounded up to whole ticks). */
export type Interval = { ticks: number } | { seconds: number };

/** Stops a scheduled event from firing again. */
export type Cancel = () => void;

/** Options every scripted event takes. */
export interface EventOptions {
	/** A name for the event, shown by the debugger. Default: the event function's name, or its kind. */
	label?: string;
}

/** A scripted event still to come, as `world.listEvents()` describes it. */
export interface ScheduledEvent {
	kind: "at" | "every" | "when";
	label: string;
	/** The next tick it fires at the start of, or undefined for a `when` (it fires on a condition). */
	nextTick?: number;
	/** Ticks between firings, for an `every`. */
	interval?: number;
}

interface Entry {
	kind: ScheduledEvent["kind"];
	label: string;
	/** Whether this entry fires at the start of `tick`. Updates its own state. */
	due(tick: number, world: World): Promise<boolean> | boolean;
	run: WorldEvent;
	/** Whether the entry may still fire without anything changing the world (for idle detection). */
	pending(tick: number): boolean;
	/** The first tick at or after `tick` it fires at, if that's known in advance. */
	next(tick: number): number | undefined;
	interval?: number;
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
	at(tick: number, run: WorldEvent, options: EventOptions = {}): Cancel {
		return this.add({
			kind: "at",
			label: labelOf("at", run, options),
			due: (t) => t === tick,
			run,
			pending: (t) => t <= tick,
			next: (t) => (t <= tick ? tick : undefined),
		});
	}

	/** Fire at the start of `first`, then every `ticks` ticks after it. */
	every(ticks: number, first: number, run: WorldEvent, options: EventOptions = {}): Cancel {
		if (!(Number.isInteger(ticks) && ticks > 0)) throw new Error(`every: interval must be at least 1 tick (got ${ticks})`);
		return this.add({
			kind: "every",
			label: labelOf("every", run, options),
			due: (t) => t >= first && (t - first) % ticks === 0,
			run,
			pending: () => true,
			next: (t) => (t <= first ? first : first + Math.ceil((t - first) / ticks) * ticks),
			interval: ticks,
		});
	}

	/**
	 * Fire whenever `condition` becomes true: it's checked at the start of each tick, and fires on
	 * the first tick it holds, then again only after it has been false.
	 */
	when(condition: (world: World) => boolean | Promise<boolean>, run: WorldEvent, options: EventOptions = {}): Cancel {
		let held = false;
		return this.add({
			kind: "when",
			label: labelOf("when", run, options),
			due: async (_t, world) => {
				const now = await condition(world);
				const fire = now && !held;
				held = now;
				return fire;
			},
			run,
			pending: () => false,
			next: () => undefined,
		});
	}

	/** Run every event due at the start of `tick`, telling `fired` about each one after it runs. */
	async fire(tick: number, world: World, fired?: (label: string) => void | Promise<void>): Promise<void> {
		for (const entry of [...this.entries]) {
			if (!(await entry.due(tick, world))) continue;
			await entry.run(world);
			await fired?.(entry.label);
		}
	}

	/** Whether an `at` or `every` event is still to come at or after `tick`. */
	pending(tick: number): boolean {
		return this.entries.some((e) => e.pending(tick));
	}

	/** The events still to come at or after `tick` (every `when`, since it may yet fire), in the order added. */
	list(tick: number): ScheduledEvent[] {
		const out: ScheduledEvent[] = [];
		for (const entry of this.entries) {
			const nextTick = entry.next(tick);
			if (entry.kind !== "when" && nextTick === undefined) continue;
			out.push({
				kind: entry.kind,
				label: entry.label,
				...(nextTick !== undefined && { nextTick }),
				...(entry.interval !== undefined && { interval: entry.interval }),
			});
		}
		return out;
	}
}

function labelOf(kind: Entry["kind"], run: WorldEvent, options: EventOptions): string {
	return options.label ?? (run.name || kind);
}
