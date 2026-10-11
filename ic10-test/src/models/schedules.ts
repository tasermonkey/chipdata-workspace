import { Reservoir } from "../atmos/mixture.ts";
import type { DeviceModel, WorldModel } from "../world/models.ts";

/** The game's default day, 1200 s (`OrbitalSimulation.DEFAULT_DAY_SECONDS`), in 0.5 s ticks. */
const DEFAULT_DAY_TICKS = 2400;
/** The game's solar constant, W/m² (`OrbitalSimulation.DEFAULT_SOLAR_CONSTANT`). */
const SOLAR_CONSTANT = 1367;

export interface DayNightOptions {
	/** Ticks in a day. Defaults to the game's 1200 s day: 2400. */
	dayTicks?: number;
	/** Where in the day tick 0 falls: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. Default 0. */
	startAt?: number;
	/** The outside room (or a sealed room) whose temperature follows the day. */
	room?: string;
	/** Kelvin at midnight and at noon, following a sine between them. Needed with `room`. */
	temperature?: { night: number; day: number };
	/** Daylight sensors (`StructureDaylightSensor`) that follow the sun. */
	sensors?: string | string[];
	/** Sunlight with the sun overhead, W/m². Default: the game's solar constant, 1367. */
	irradiance?: number;
}

/**
 * A day/night cycle: the weather timer. Each tick it sets a room's temperature from the time of
 * day, and moves the sun for daylight sensors. The sun rises at a quarter of the day and sets at
 * three quarters, peaking overhead at noon.
 *
 * A sensor's `Activate` is 1 while the sun is up, `Vertical` and `SolarAngle` are the sun's angle
 * from straight up (0 overhead, 90 on the horizon, more below it), `Horizontal` turns through 360°
 * over the day (0 at midnight, 180 at noon), and `SolarIrradiance` is `irradiance` scaled by the
 * sun's height. These angles are a guess at the game's, for a sensor facing up; a script that aims
 * solar panels needs its own offsets checked in game.
 */
export function dayNight(options: DayNightOptions): WorldModel {
	const dayTicks = options.dayTicks ?? DEFAULT_DAY_TICKS;
	const startAt = options.startAt ?? 0;
	const sensors = typeof options.sensors === "string" ? [options.sensors] : (options.sensors ?? []);
	const irradiance = options.irradiance ?? SOLAR_CONSTANT;
	if (!(dayTicks > 0)) throw new Error(`dayNight: dayTicks must be positive, got ${dayTicks}`);
	if (options.room !== undefined && !options.temperature) throw new Error("dayNight: a room needs temperature: { night, day }");
	return (_dt, world) => {
		const phase = (((world.tick / dayTicks + startAt) % 1) + 1) % 1;
		// The sun's height: 1 overhead at noon, 0 on the horizon, -1 straight down at midnight.
		const height = Math.sin(2 * Math.PI * (phase - 0.25));
		if (options.room !== undefined && options.temperature) {
			const { night, day } = options.temperature;
			const kelvin = night + ((day - night) * (1 + height)) / 2;
			const room = world.room(options.room);
			if (room instanceof Reservoir) room.set({ temperature: kelvin });
			else room.setTemperature(kelvin);
		}
		const fromZenith = 90 - 90 * height;
		for (const key of sensors) {
			world
				.device(key)
				.set("Activate", height > 0 ? 1 : 0)
				.set("Vertical", fromZenith)
				.set("SolarAngle", fromZenith)
				.set("Horizontal", 360 * phase)
				.set("SolarIrradiance", irradiance * Math.max(height, 0));
		}
	};
}

export interface OccupancyWindow {
	/** First tick of the window. */
	from: number;
	/** The tick it ends at (not included). */
	to: number;
	/** How many people are in the room meanwhile. Default 1. */
	people?: number;
}

export interface OccupancyOptions {
	/** Repeat the schedule every this many ticks (a day, say). Without it, it runs once. */
	everyTicks?: number;
}

/**
 * An occupancy sensor (`StructureOccupancySensor`) following a schedule. Each tick it sets
 * `Quantity` to the people in the windows covering that tick (overlapping windows add up) and
 * `Activate` to 1 when there's anyone.
 */
export function occupancySchedule(windows: OccupancyWindow[], options: OccupancyOptions = {}): DeviceModel {
	const every = options.everyTicks;
	if (every !== undefined && !(every > 0)) throw new Error(`occupancySchedule: everyTicks must be positive, got ${every}`);
	for (const w of windows) {
		if (!(w.to > w.from)) throw new Error(`occupancySchedule: a window must end after it starts (from ${w.from}, to ${w.to})`);
	}
	return (sensor, _dt, world) => {
		const tick = every === undefined ? world.tick : world.tick % every;
		const people = windows.reduce((sum, w) => sum + (tick >= w.from && tick < w.to ? (w.people ?? 1) : 0), 0);
		sensor.set("Quantity", people).set("Activate", people > 0 ? 1 : 0);
	};
}
