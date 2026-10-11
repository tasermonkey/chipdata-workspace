import { type GasAmounts, type GasName, GASES, gasInfo, IDEAL_GAS_CONSTANT } from "./gases.ts";

/** Some gas on its way between atmospheres: moles of each gas at one temperature. */
export interface GasParcel {
	gases: GasAmounts;
	/** Kelvin. */
	temperature: number;
}

/**
 * What a pipe network or room offers to devices and models. Plausible rather than exact: an ideal
 * gas, mixed perfectly and instantly, with no phase changes.
 */
export interface Atmosphere {
	/** Litres; `Infinity` for a reservoir. */
	readonly volume: number;
	/** kPa, from the gases (not liquids): P = nRT/V. */
	readonly pressure: number;
	/** Kelvin. */
	readonly temperature: number;
	/** All moles, liquids included. */
	readonly totalMoles: number;
	moles(gas: GasName): number;
	/** This gas's share of the total moles, 0 to 1 (0 when empty). */
	ratio(gas: GasName): number;
	/** J/K: the sum of each gas's moles × specific heat. */
	readonly heatCapacity: number;
	/** Remove `moles` in proportion to what's here (all of it, if there's less). */
	take(moles: number): GasParcel;
	/** Remove up to `moles` of one gas. */
	takeGas(gas: GasName, moles: number): GasParcel;
	/** Add a parcel, mixing its heat in. */
	merge(parcel: GasParcel): this;
	/** Add (or, if negative, remove) heat in joules. */
	addHeat(joules: number): this;
}

export interface MixtureInit {
	/** Litres. A pipe segment is 10 (`PIPE_VOLUME`); a grid cell 8000 (`GRID_VOLUME`). */
	volume: number;
	/** Kelvin. */
	temperature: number;
	/** Moles of each gas. */
	gases?: GasAmounts;
}

export interface PressureInit {
	volume: number;
	temperature: number;
	/** kPa. */
	pressure: number;
	/** Share of each gas; normalised, so `{ Nitrogen: 7, Oxygen: 3 }` works too. */
	ratios: GasAmounts;
}

function entries(gases: GasAmounts): [GasName, number][] {
	return Object.entries(gases).filter(([, n]) => n !== undefined && n !== 0) as [GasName, number][];
}

/** The ratios scaled to sum to 1. */
function normalise(ratios: GasAmounts): [GasName, number][] {
	const list = entries(ratios);
	for (const [gas, r] of list) {
		gasInfo(gas);
		if (!(r > 0)) throw new Error(`Ratio of ${gas} must be positive, got ${r}`);
	}
	const sum = list.reduce((s, [, r]) => s + r, 0);
	return list.map(([gas, r]) => [gas, r / sum]);
}

function parcelCapacity(parcel: GasParcel): number {
	return entries(parcel.gases).reduce((c, [gas, n]) => c + n * gasInfo(gas).specificHeat, 0);
}

/** Gas in a closed volume: a pipe network or a sealed room. */
export class Mixture implements Atmosphere {
	readonly volume: number;
	private kelvin: number;
	private readonly amounts = new Map<GasName, number>();

	constructor(init: MixtureInit) {
		if (!(init.volume > 0) || !Number.isFinite(init.volume)) {
			throw new Error(`A mixture's volume must be a positive number of litres, got ${init.volume}`);
		}
		checkTemperature(init.temperature);
		this.volume = init.volume;
		this.kelvin = init.temperature;
		for (const [gas, n] of entries(init.gases ?? {})) this.add(gas, n);
	}

	/** A mixture at a pressure, rather than a number of moles. */
	static fromPressure(init: PressureInit): Mixture {
		const mixture = new Mixture({ volume: init.volume, temperature: init.temperature });
		const ratios = normalise(init.ratios);
		// Liquids add moles but no pressure, so only the gases' share sets the total.
		const gasShare = ratios.reduce((s, [gas, r]) => s + (gasInfo(gas).liquid ? 0 : r), 0);
		if (init.pressure > 0 && gasShare === 0) throw new Error("A pressure needs at least one gas that isn't a liquid");
		const total = gasShare === 0 ? 0 : (init.pressure * init.volume) / (IDEAL_GAS_CONSTANT * init.temperature) / gasShare;
		for (const [gas, r] of ratios) mixture.add(gas, total * r);
		return mixture;
	}

	get temperature(): number {
		return this.kelvin;
	}

	get totalMoles(): number {
		let n = 0;
		for (const m of this.amounts.values()) n += m;
		return n;
	}

	get pressure(): number {
		let n = 0;
		for (const [gas, m] of this.amounts) if (!gasInfo(gas).liquid) n += m;
		return (n * IDEAL_GAS_CONSTANT * this.kelvin) / this.volume;
	}

	get heatCapacity(): number {
		let c = 0;
		for (const [gas, m] of this.amounts) c += m * gasInfo(gas).specificHeat;
		return c;
	}

	moles(gas: GasName): number {
		gasInfo(gas);
		return this.amounts.get(gas) ?? 0;
	}

	ratio(gas: GasName): number {
		const total = this.totalMoles;
		return total > 0 ? this.moles(gas) / total : 0;
	}

	/** Every gas present, in `GasType` order. */
	gases(): GasAmounts {
		const out: GasAmounts = {};
		for (const { name } of GASES) {
			const n = this.amounts.get(name);
			if (n) out[name] = n;
		}
		return out;
	}

	/** Add moles of one gas, at `temperature` (default: this mixture's). */
	add(gas: GasName, moles: number, temperature = this.kelvin): this {
		if (moles < 0) throw new Error(`Can't add ${moles} mol of ${gas}; use takeGas to remove gas`);
		return this.merge({ gases: { [gas]: moles }, temperature });
	}

	/** Set the temperature, keeping the moles (so the pressure changes too). */
	setTemperature(kelvin: number): this {
		checkTemperature(kelvin);
		this.kelvin = kelvin;
		return this;
	}

	merge(parcel: GasParcel): this {
		checkTemperature(parcel.temperature);
		const before = this.heatCapacity;
		const added = parcelCapacity(parcel);
		if (before + added > 0) {
			this.kelvin = (before * this.kelvin + added * parcel.temperature) / (before + added);
		}
		for (const [gas, n] of entries(parcel.gases)) {
			gasInfo(gas);
			if (n < 0) throw new Error(`A parcel can't hold ${n} mol of ${gas}`);
			this.amounts.set(gas, (this.amounts.get(gas) ?? 0) + n);
		}
		return this;
	}

	take(moles: number): GasParcel {
		const total = this.totalMoles;
		const share = total > 0 ? Math.min(Math.max(moles, 0) / total, 1) : 0;
		const gases: GasAmounts = {};
		for (const [gas, m] of this.amounts) {
			const n = m * share;
			if (n > 0) gases[gas] = n;
			this.set(gas, m - n);
		}
		return { gases, temperature: this.kelvin };
	}

	takeGas(gas: GasName, moles: number): GasParcel {
		const have = this.moles(gas);
		const n = Math.min(Math.max(moles, 0), have);
		this.set(gas, have - n);
		return { gases: n > 0 ? { [gas]: n } : {}, temperature: this.kelvin };
	}

	addHeat(joules: number): this {
		const capacity = this.heatCapacity;
		if (capacity > 0) this.kelvin = Math.max(this.kelvin + joules / capacity, 0);
		return this;
	}

	clone(): Mixture {
		return new Mixture({ volume: this.volume, temperature: this.kelvin, gases: this.gases() });
	}

	private set(gas: GasName, moles: number) {
		// Rounding can leave a hair of gas behind, or below zero; treat that as none.
		if (moles <= 1e-12) this.amounts.delete(gas);
		else this.amounts.set(gas, moles);
	}
}

export interface ReservoirInit {
	/** Kelvin. */
	temperature: number;
	/** kPa. */
	pressure: number;
	/** Share of each gas; normalised. */
	ratios: GasAmounts;
}

/**
 * An atmosphere too big to change: a planet's outside air. Gas taken from it comes out at its
 * pressure's composition and temperature, gas and heat added to it vanish, and its readings stay
 * fixed unless a test changes them.
 */
export class Reservoir implements Atmosphere {
	readonly volume = Infinity;
	readonly totalMoles = Infinity;
	readonly heatCapacity = Infinity;
	private kelvin: number;
	private kPa: number;
	private shares: [GasName, number][];

	constructor(init: ReservoirInit) {
		checkTemperature(init.temperature);
		if (!(init.pressure >= 0)) throw new Error(`A reservoir's pressure can't be ${init.pressure}`);
		this.kelvin = init.temperature;
		this.kPa = init.pressure;
		this.shares = normalise(init.ratios);
	}

	get temperature(): number {
		return this.kelvin;
	}

	get pressure(): number {
		return this.kPa;
	}

	moles(gas: GasName): number {
		return this.ratio(gas) > 0 ? Infinity : 0;
	}

	ratio(gas: GasName): number {
		gasInfo(gas);
		return this.shares.find(([g]) => g === gas)?.[1] ?? 0;
	}

	/** Change the weather: any of temperature, pressure and ratios. */
	set(change: Partial<ReservoirInit>): this {
		if (change.temperature !== undefined) {
			checkTemperature(change.temperature);
			this.kelvin = change.temperature;
		}
		if (change.pressure !== undefined) this.kPa = change.pressure;
		if (change.ratios !== undefined) this.shares = normalise(change.ratios);
		return this;
	}

	take(moles: number): GasParcel {
		const n = Math.max(moles, 0);
		const gases: GasAmounts = {};
		if (this.kPa > 0) for (const [gas, r] of this.shares) gases[gas] = n * r;
		return { gases, temperature: this.kelvin };
	}

	takeGas(gas: GasName, moles: number): GasParcel {
		const n = this.ratio(gas) > 0 && this.kPa > 0 ? Math.max(moles, 0) : 0;
		return { gases: n > 0 ? { [gas]: n } : {}, temperature: this.kelvin };
	}

	merge(parcel: GasParcel): this {
		checkTemperature(parcel.temperature);
		return this;
	}

	addHeat(_joules: number): this {
		return this;
	}
}

/**
 * Move heat between two atmospheres, `fraction` (0 to 1) of the way to the temperature they'd
 * share if they settled. Energy is conserved; a reservoir's temperature doesn't move. A model
 * calls this each tick with a fraction from its conductance, e.g. a radiator between two pipes.
 */
export function exchangeHeat(a: Atmosphere, b: Atmosphere, fraction: number): void {
	const f = Math.min(Math.max(fraction, 0), 1);
	const ca = a.heatCapacity;
	const cb = b.heatCapacity;
	if (ca === 0 || cb === 0 || f === 0) return;
	let settled: number;
	if (ca === Infinity && cb === Infinity) return;
	else if (ca === Infinity) settled = a.temperature;
	else if (cb === Infinity) settled = b.temperature;
	else settled = (ca * a.temperature + cb * b.temperature) / (ca + cb);
	if (ca !== Infinity) a.addHeat(f * ca * (settled - a.temperature));
	if (cb !== Infinity) b.addHeat(f * cb * (settled - b.temperature));
}

function checkTemperature(kelvin: number) {
	if (!(kelvin >= 0) || !Number.isFinite(kelvin)) throw new Error(`A temperature must be kelvin, 0 or above, got ${kelvin}`);
}
