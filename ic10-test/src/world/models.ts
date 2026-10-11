import type { Cancel } from "./events.ts";
import type { DeviceHandle, World } from "./world.ts";

/**
 * How a device behaves, run once a tick: it reads what scripts set on the device and changes the
 * world (moves gas between pipes and rooms, moves heat). `dt` is the tick's length in seconds.
 */
export type DeviceModel = (device: DeviceHandle, dt: number, world: World) => void;

/** World behaviour that isn't one device's, run once a tick: a radiator between two pipes, say. */
export type WorldModel = (dt: number, world: World) => void;

interface Entry {
	/** For error messages: the device's key, or "world". */
	label: string;
	run(dt: number, world: World): void;
}

/**
 * Device and world models. They run at the start of each tick, after scripted events and before
 * devices refresh their readings and chips run, in the order they were added. So a setting a chip
 * writes in one tick takes effect in the next, as the game's atmospherics follow its logic.
 */
export class ModelList {
	private entries: Entry[] = [];

	add(label: string, run: (dt: number, world: World) => void): Cancel {
		const entry = { label, run };
		this.entries.push(entry);
		return () => {
			this.entries = this.entries.filter((e) => e !== entry);
		};
	}

	get size(): number {
		return this.entries.length;
	}

	/** What each model is for, in the order they run: a device's key, or "world". */
	labels(): string[] {
		return this.entries.map((e) => e.label);
	}

	run(dt: number, world: World, tick: number): void {
		for (const entry of [...this.entries]) {
			try {
				entry.run(dt, world);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`model for ${entry.label} failed in tick ${tick}: ${message}`, { cause: error });
			}
		}
	}
}
