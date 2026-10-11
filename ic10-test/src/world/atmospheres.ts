import type { Device } from "@stationeers-ic/ic10";
import { GASES, GRID_VOLUME, IDEAL_GAS_CONSTANT } from "../atmos/gases.ts";
import { type Atmosphere, Mixture, type MixtureInit, type PressureInit, Reservoir, type ReservoirInit } from "../atmos/mixture.ts";
import { hasProp, writeProp } from "../engine/device.ts";

/** A pipe network: a volume of gas, by moles or by pressure. */
export type PipeInit = MixtureInit | PressureInit;

/**
 * A room. With a `volume`, a sealed room whose gas a model can change; without one, a reservoir
 * too big to change (a planet's outside air).
 */
export type RoomInit = MixtureInit | PressureInit | ReservoirInit;

export type Port = "input" | "input2" | "output" | "output2";

/** Each port's readings end in this: `input` gives `PressureInput`, `RatioNitrogenInput`, …. */
export const PORT_SUFFIX: Record<Port, string> = { input: "Input", input2: "Input2", output: "Output", output2: "Output2" };

/** Where a device is attached, as declared (by atmosphere key). */
export interface AttachOptions {
	/**
	 * The pipe the device sits on, giving its own readings (`Pressure`, `Temperature`, `TotalMoles`,
	 * `Ratio<Gas>`, `Volume`): a pipe analyzer's pipe.
	 */
	pipe?: string;
	/**
	 * The room the device is in: a gas sensor's (which gives its own readings, unless it has a
	 * `pipe`), or the room a vent or AC unit blows into.
	 */
	room?: string;
	/**
	 * Pipes on the device's ports, by the suffix of the readings they give: `input` →
	 * `PressureInput`, `output2` → `PressureOutput2`. A vent's one pipe is its `output`.
	 */
	ports?: Partial<Record<Port, string>>;
}

export type AtmosphereKind = "pipe" | "room";

/** An atmosphere in the world, with its key and kind. */
export interface AtmosphereEntry {
	key: string;
	kind: AtmosphereKind;
	atmosphere: Mixture | Reservoir;
}

/** A device's attachments, resolved. */
export interface Attachments {
	pipe?: AtmosphereEntry;
	room?: AtmosphereEntry;
	ports: Partial<Record<Port, AtmosphereEntry>>;
}

/** One reading a device takes from an atmosphere. */
export interface Reading {
	prop: string;
	source: AtmosphereEntry;
	value(): number;
}

export function makePipe(key: string, init: PipeInit): AtmosphereEntry {
	if (!("volume" in init)) throw new Error(`sim: pipe "${key}" needs a volume in litres (a segment is PIPE_VOLUME, 10)`);
	return { key, kind: "pipe", atmosphere: makeMixture(init) };
}

export function makeRoom(key: string, init: RoomInit): AtmosphereEntry {
	if ("volume" in init) return { key, kind: "room", atmosphere: makeMixture(init) };
	if ("gases" in init) throw new Error(`sim: room "${key}" without a volume is outside air: give { temperature, pressure, ratios }`);
	return { key, kind: "room", atmosphere: new Reservoir(init) };
}

function makeMixture(init: MixtureInit | PressureInit): Mixture {
	return "pressure" in init ? Mixture.fromPressure(init) : new Mixture(init);
}

/**
 * Moles a reading reports: a pipe's whole network, but a room's one grid cell, as a gas sensor
 * reads the cell it's in.
 */
function readingMoles(entry: AtmosphereEntry): number {
	const atmos = entry.atmosphere;
	if (entry.kind === "pipe") return atmos.totalMoles;
	if (atmos instanceof Reservoir) {
		return atmos.temperature > 0 ? (atmos.pressure * GRID_VOLUME) / (IDEAL_GAS_CONSTANT * atmos.temperature) : 0;
	}
	return (atmos.totalMoles * GRID_VOLUME) / atmos.volume;
}

/** The readings an atmosphere gives with this suffix ("" for a device's own). */
function readingsWith(suffix: string, source: AtmosphereEntry): Reading[] {
	const atmos: Atmosphere = source.atmosphere;
	const out: Reading[] = [
		{ prop: `Pressure${suffix}`, source, value: () => atmos.pressure },
		{ prop: `Temperature${suffix}`, source, value: () => atmos.temperature },
		{ prop: `TotalMoles${suffix}`, source, value: () => readingMoles(source) },
		...GASES.map((g) => ({ prop: `Ratio${g.name}${suffix}`, source, value: () => atmos.ratio(g.name) })),
	];
	if (suffix === "" && source.kind === "pipe") out.push({ prop: "Volume", source, value: () => atmos.volume });
	return out;
}

/**
 * Every reading the device takes from its attachments, keeping those it has. Throws if an
 * attachment gives the device no readings at all, with a hint at what it does have.
 */
export function deviceReadings(key: string, device: Device, prefab: string, attached: Attachments): Reading[] {
	const out: Reading[] = [];
	const own = attached.pipe ?? attached.room;
	if (own) {
		const readings = readingsWith("", own).filter((r) => hasProp(device, r.prop));
		if (readings.length === 0 && attached.pipe) throw new Error(noReadings(key, prefab, device, "pipe", ""));
		out.push(...readings);
	}
	for (const [port, source] of Object.entries(attached.ports) as [Port, AtmosphereEntry][]) {
		const readings = readingsWith(PORT_SUFFIX[port], source).filter((r) => hasProp(device, r.prop));
		if (readings.length === 0) throw new Error(noReadings(key, prefab, device, `ports.${port}`, PORT_SUFFIX[port]));
		out.push(...readings);
	}
	return out;
}

function noReadings(key: string, prefab: string, device: Device, option: string, suffix: string): string {
	const has = (Object.entries(PORT_SUFFIX) as [Port, string][])
		.filter(([, s]) => hasProp(device, `Pressure${s}`))
		.map(([port]) => `ports.${port}`);
	if (hasProp(device, "Pressure")) has.unshift("pipe");
	const hint = has.length > 0 ? `; it has ${has.join(", ")}` : "; it has no pipe readings";
	return `sim: "${key}": ${prefab} has no Pressure${suffix}, so { ${option} } gives it nothing${hint}`;
}

/** Write each reading into the device, as the game updates readings every tick. */
export function applyReadings(device: Device, readings: readonly Reading[]): void {
	for (const reading of readings) writeProp(device, reading.prop, reading.value());
}
