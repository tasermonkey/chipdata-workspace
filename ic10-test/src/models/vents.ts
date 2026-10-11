import { GRID_VOLUME, ONE_ATMOSPHERE } from "../atmos/gases.ts";
import { Reservoir } from "../atmos/mixture.ts";
import type { DeviceModel } from "../world/models.ts";
import type { DeviceHandle } from "../world/world.ts";
import { clamp, gameTicks, molesFor as moles } from "./flow.ts";

/** An active vent's pipe-side limit in Inward mode: 500 atmospheres. */
const MAX_PIPE_PRESSURE = 500 * ONE_ATMOSPHERE;

export interface VentOptions {
	/**
	 * The most the vent moves in a tick, as kPa of one grid cell of its room. The game sets this per
	 * prefab in its asset files, which the harness can't read, so the default is a guess: 10 for an
	 * active vent, 50 for a powered one.
	 */
	pressurePerTick?: number;
}

interface Limits {
	external: number;
	internal: number;
}

/**
 * An Active Vent (`StructureActiveVent`), following the game's `ActiveVent`. Attach it with
 * `{ ports: { output: pipe }, room }`. While `On`, each tick:
 * - Mode 0, Outward: pipe → room, until the room reaches `PressureExternal`, never taking the pipe
 *   below `PressureInternal`.
 * - Mode 1, Inward: room → pipe, until the room falls to `PressureExternal`, never filling the pipe
 *   above `PressureInternal`.
 *
 * Changing `Mode` resets both limits to that mode's defaults (Outward 101.325 kPa / 0, Inward
 * 0 / 50,662.5 kPa), as the game does. The model sees a change at the start of the next tick, so
 * a limit the script also changed in that tick is kept (the script is taken to have set it after
 * the mode). A vent built with neither limit set starts with its mode's defaults.
 */
export function activeVent(options: VentOptions = {}): DeviceModel {
	return ventModel("active", options.pressurePerTick ?? 10);
}

/**
 * A Powered Vent (`StructurePoweredVent`), following the game's `PoweredVent`: as an active vent,
 * but with only `PressureExternal` (Outward default 101.325 kPa, Inward 0) and no pipe-side limit.
 */
export function poweredVent(options: VentOptions = {}): DeviceModel {
	return ventModel("powered", options.pressurePerTick ?? 50);
}

function modeDefaults(kind: "active" | "powered", mode: number): Limits {
	const inward = mode === 1;
	return {
		external: inward ? 0 : ONE_ATMOSPHERE,
		internal: kind === "powered" ? (inward ? Infinity : 0) : inward ? MAX_PIPE_PRESSURE : 0,
	};
}

function ventModel(kind: "active" | "powered", pressurePerTick: number): DeviceModel {
	const seen = new Map<string, { mode: number } & Limits>();
	return (vent, dt) => {
		const pipe = vent.port("output");
		const room = vent.room;
		if (!pipe || !room) {
			throw new Error(`${kind} vent "${vent.key}" needs a pipe and a room: { ports: { output: "<pipe>" }, room: "<room>" }`);
		}
		const limits = currentLimits(kind, vent, seen);
		if (vent.get("On") !== 1) return;

		const chunk = pressurePerTick * gameTicks(dt);
		const cell = room instanceof Reservoir ? GRID_VOLUME : Math.min(room.volume, GRID_VOLUME);
		if (vent.get("Mode") === 1) {
			// Inward: lower the room's cell by up to `chunk`, down to External; fill the pipe up to Internal.
			const drop = clamp(room.pressure - limits.external, 0, chunk);
			const fromRoom = moles(drop, cell, room.temperature);
			const pipeSpace = moles(limits.internal - pipe.pressure, pipe.volume, room.temperature);
			pipe.merge(room.take(Math.min(fromRoom, pipeSpace)));
		} else {
			// Outward: raise the room's cell by up to `chunk`, up to External; keep the pipe above Internal.
			const rise = clamp(limits.external - room.pressure, 0, chunk);
			const intoRoom = moles(rise, cell, pipe.temperature);
			const spare = moles(pipe.pressure - limits.internal, pipe.volume, pipe.temperature);
			room.merge(pipe.take(Math.min(intoRoom, spare)));
		}
	};
}

/** The vent's limits now, applying the game's reset when its mode has changed. */
function currentLimits(kind: "active" | "powered", vent: DeviceHandle, seen: Map<string, { mode: number } & Limits>): Limits {
	const hasInternal = kind === "active";
	const mode = vent.get("Mode");
	let external = vent.get("PressureExternal");
	let internal = hasInternal ? vent.get("PressureInternal") : modeDefaults(kind, mode).internal;
	const before = seen.get(vent.key);
	const defaults = modeDefaults(kind, mode);
	if (!before) {
		if (external === 0 && (!hasInternal || internal === 0)) {
			external = defaults.external;
			if (hasInternal) internal = defaults.internal;
		}
	} else if (mode !== before.mode) {
		if (external === before.external) external = defaults.external;
		if (hasInternal && internal === before.internal) internal = defaults.internal;
	}
	if (!hasInternal) internal = defaults.internal;
	vent.set("PressureExternal", external);
	if (hasInternal) vent.set("PressureInternal", internal);
	seen.set(vent.key, { mode, external, internal: hasInternal ? internal : 0 });
	return { external, internal };
}

