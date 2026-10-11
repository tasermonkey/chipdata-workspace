import { hash } from "../engine/device.ts";
import type { DeviceModel } from "../world/models.ts";
import type { DeviceHandle } from "../world/world.ts";
import { clamp } from "./flow.ts";

// From the game's code (`RoboticArmDock`, `RoboticArm`, `RoboticArmDockHydroponics`):
/** The arm's animation down, then up: `RoboticArm.AnimateAsync` runs 0 to 1 by frame time. */
const ARM_DOWN_SECONDS = 1;
const ARM_UP_SECONDS = 1;
/** `WaitThenSetActivate`: the pause after the arm acts, before it comes up. */
const ARM_WAIT_SECONDS = 0.2;
/** `RoboticArmDock._moveSpeed`'s code default, rail nodes a second. A prefab may override it. */
const DEFAULT_SPEED = 1;
/** `Slot.Class.Plant`. */
const PLANT_CLASS = 11;
const HAND = 0;
const EXTRA = 1;
/** `RoboticArmDockHydroponics.PROXY_SLOT_ID`: the slot of whatever the arm faces. */
const TARGET = 255;
const PLANTER_HASH = hash("StructureHydroponicsTray");
const BIN_HASH = hash("StructureChuteBin");

/** A plant in a planter. It doesn't grow: it stays as the test sets it until the arm takes from it. */
export interface LarrePlant {
	/** The plant's item, as slot 255 shows it. Default "ItemWheat". */
	item?: string;
	/** What a harvest gives. Default "ItemWheat". */
	fruit?: string;
	/** What it gives while seeding, and what plants it again. Default "SeedBag_Wheet". */
	seed?: string;
	mature?: boolean;
	seeding?: boolean;
	/** Seeds left to take while seeding. Default 0. */
	seeds?: number;
	/** Fruit left to take. Default 0. */
	harvest?: number;
	/** When all is taken, it starts growing again instead of going. */
	perennial?: boolean;
}

export interface LarreStack {
	item: string;
	quantity: number;
}

export interface LarreDelivery extends LarreStack {
	station: number;
	tick: number;
}

export interface LarreDockOptions {
	/**
	 * Junctions on the rail (docks and junction rails), numbered from the starting dock, 0, which
	 * the model puts at one end. (In game a starting dock mid-rail numbers one side negative.)
	 */
	stations: number;
	/** Stations with a planter: its plant, or `null` for an empty planter. */
	planters?: Record<number, LarrePlant | null>;
	/** Stations with an import bin (`StructureChuteBin`), where the arm drops what it holds. */
	dropOff?: number | number[];
	/** The bins keep what's dropped, so the next drop does nothing. Default: they pass it on. */
	jammed?: boolean;
	/**
	 * Rail nodes from one station to the next: one number, or by station (key n: from n - 1 to n;
	 * on a loop, key 0 is from the last station back to 0). Default 1, a guess: the game's rail
	 * pieces set their nodes in asset files.
	 */
	nodes?: number | Record<number, number>;
	/** Rail nodes a second. Default the game's code default, 1: 2 ticks for a 1-node gap. */
	speed?: number;
	/** The rail is a loop: Setting wraps instead of clamping, and the arm takes the shorter way. */
	looping?: boolean;
	/** The station the arm starts at. Default 0. */
	start?: number;
	/** What the arm holds at the start (slot 0), and in its extra slot (slot 1). */
	hand?: LarreStack;
	extra?: LarreStack;
	/** Most of one item a stack holds. Default 50, a guess. */
	stackSize?: number;
}

/** A hydroponics Larre's state, for the test to read. Add `model` with `world.model(key, …)`. */
export interface LarreDock {
	readonly model: DeviceModel;
	/** The stations the arm stopped at, in order. */
	readonly visited: readonly number[];
	/** What the arm dropped into a bin. */
	readonly delivered: readonly LarreDelivery[];
	readonly hand: LarreStack | undefined;
	readonly extra: LarreStack | undefined;
	/** The station the arm is at, or -1 while it moves. */
	readonly station: number;
	/** The plant at a station's planter: `null` for an empty planter, undefined if there's none. */
	planter(station: number): Readonly<Required<LarrePlant>> | null | undefined;
}

type Plant = Required<LarrePlant>;

/**
 * A hydroponics Larre (`StructureLarreDockHydroponics`) on a rail of stations, following the game's
 * `RoboticArmDockHydroponics`. Needs `On` set.
 *
 * - `Setting` picks the station; the game clamps it to the rail (wraps it on a loop) as it's
 *   written. The arm then moves along the rail at `speed` nodes a second.
 * - `Activate` is ignored while the arm moves. Otherwise the arm goes down (1 s), acts, waits
 *   0.2 s and comes up (1 s): `Activate` drops to 0 when it's down, is 1 while it comes up, and 0
 *   once it's up. `Extended` is 1 while it's down.
 * - `Idle` is 1 only with the arm up and still (or the dock off). `PositionX` is the station,
 *   -1 while moving.
 * - At a planter, with the hand (slot 0) empty, the arm takes one item from the plant: a seed
 *   while seeding with seeds left, else one fruit. With the hand holding the same item, it adds to
 *   the stack; holding something else, that goes to slot 1 first, and if slot 1 is full nothing
 *   happens. A plant with nothing to take is destroyed by an empty hand. The plant goes once all is
 *   taken. At an empty planter, a seed in the hand plants one.
 * - At a bin, the hand's whole stack goes in. After any action, slot 1 moves to an empty hand.
 * - Slot 255 shows the plant at the arm (`Class` 11, `Mature` 0/1, `Seeding` -1 not seeding,
 *   0 no seeds left, 1 seeds to take), or a jammed bin's item; `TargetSlotIndex` and
 *   `TargetPrefabHash` describe what the arm faces.
 */
export function larreDock(options: LarreDockOptions): LarreDock {
	return new Larre(options);
}

class Larre implements LarreDock {
	readonly visited: number[] = [];
	readonly delivered: LarreDelivery[] = [];
	hand: LarreStack | undefined;
	extra: LarreStack | undefined;
	readonly model: DeviceModel;

	private readonly count: number;
	private readonly looping: boolean;
	private readonly speed: number;
	private readonly stackSize: number;
	private readonly jammed: boolean;
	/** Each station's place on the rail, in nodes. */
	private readonly at: number[] = [];
	/** The whole loop's length in nodes (the last station's place, off a loop). */
	private readonly length: number;
	private readonly planters = new Map<number, Plant | null>();
	private readonly bins = new Set<number>();
	private readonly binHolds = new Map<number, LarreStack>();
	private readonly seeds = new Map<string, Plant>();
	private position: number;
	private started = false;
	/** Seconds into an Activate cycle, while one runs. */
	private cycle: { t: number; acted: boolean; up: boolean } | undefined;

	constructor(options: LarreDockOptions) {
		const { stations } = options;
		if (!Number.isInteger(stations) || stations < 1) throw new Error(`larreDock: stations must be a whole number from 1, got ${stations}`);
		this.count = stations;
		this.looping = options.looping ?? false;
		this.speed = options.speed ?? DEFAULT_SPEED;
		this.stackSize = options.stackSize ?? 50;
		this.jammed = options.jammed ?? false;
		if (!(this.speed > 0)) throw new Error(`larreDock: speed must be positive, got ${this.speed}`);

		const gap = (n: number) => {
			const nodes = typeof options.nodes === "object" ? (options.nodes[n] ?? 1) : (options.nodes ?? 1);
			if (!(nodes > 0)) throw new Error(`larreDock: nodes to station ${n} must be positive, got ${nodes}`);
			return nodes;
		};
		this.at.push(0);
		for (let n = 1; n < stations; n++) this.at.push(this.at[n - 1] + gap(n));
		this.length = this.looping ? this.at[stations - 1] + gap(0) : this.at[stations - 1];

		for (const [key, plant] of Object.entries(options.planters ?? {})) {
			const station = this.check(Number(key), "a planter");
			this.planters.set(station, plant && this.plant(plant));
		}
		const bins = options.dropOff === undefined ? [] : [options.dropOff].flat();
		for (const station of bins) this.bins.add(this.check(station, "a drop-off"));
		this.position = this.at[this.check(options.start ?? 0, "the start")];
		this.hand = options.hand && { ...options.hand };
		this.extra = options.extra && { ...options.extra };
		this.model = (device, dt, world) => this.tick(device, dt, world.tick);
	}

	get station(): number {
		return this.stationAt(this.position);
	}

	planter(station: number): Plant | null | undefined {
		const plant = this.planters.get(station);
		return plant ? { ...plant } : plant;
	}

	private check(station: number, what: string): number {
		if (!Number.isInteger(station) || station < 0 || station >= this.count) {
			throw new Error(`larreDock: ${what} at station ${station} is off the rail (stations 0 to ${this.count - 1})`);
		}
		return station;
	}

	private plant(plant: LarrePlant): Plant {
		const full: Plant = {
			item: "ItemWheat",
			fruit: "ItemWheat",
			seed: "SeedBag_Wheet",
			mature: false,
			seeding: false,
			seeds: 0,
			harvest: 0,
			perennial: false,
			...plant,
		};
		this.seeds.set(full.seed, full);
		return full;
	}

	private tick(device: DeviceHandle, dt: number, tick: number): void {
		if (!this.started) {
			// The dock starts with its Setting at its station, unless something has written one.
			this.started = true;
			if (device.get("Setting") === 0) device.set("Setting", this.station);
		}
		const operable = device.get("On") === 1;
		const wanted = Math.trunc(device.get("Setting"));
		const target = this.looping ? wrap(wanted, this.count) : clamp(wanted, 0, this.count - 1);
		device.set("Setting", target);
		const goal = this.at[target];

		if (this.cycle) {
			this.runCycle(device, dt, tick);
		} else if (device.get("Activate") === 1) {
			if (operable && this.position === goal) {
				this.cycle = { t: 0, acted: false, up: false };
				this.runCycle(device, dt, tick);
			} else {
				device.set("Activate", 0); // the game ignores it while moving or off
			}
		}
		if (!this.cycle && operable && this.position !== goal) {
			this.move(goal, this.speed * dt);
			if (this.position === goal) this.visited.push(target);
		}

		// As in the game, a dock that's off isn't moving, so it reads Idle wherever it stopped.
		const moving = !this.cycle && operable && this.position !== goal;
		device.set("Idle", !this.cycle && !moving ? 1 : 0).set("PositionX", moving ? -1 : this.station);
		this.show(device);
	}

	/** Advance the Activate cycle by `dt`: down, act, wait, up. */
	private runCycle(device: DeviceHandle, dt: number, tick: number): void {
		const cycle = this.cycle as NonNullable<Larre["cycle"]>;
		cycle.t += dt;
		if (!cycle.acted && cycle.t >= ARM_DOWN_SECONDS) {
			cycle.acted = true;
			device.set("Activate", 0).set("Extended", 1);
			this.act(this.station, tick);
		}
		if (!cycle.up && cycle.t >= ARM_DOWN_SECONDS + ARM_WAIT_SECONDS) {
			cycle.up = true;
			device.set("Activate", 1).set("Extended", 0);
		}
		if (cycle.t >= ARM_DOWN_SECONDS + ARM_WAIT_SECONDS + ARM_UP_SECONDS) {
			device.set("Activate", 0);
			this.cycle = undefined;
		}
	}

	private move(goal: number, step: number): void {
		let ahead = goal - this.position;
		if (this.looping) {
			const forward = (((goal - this.position) % this.length) + this.length) % this.length;
			ahead = forward <= this.length - forward ? forward : forward - this.length;
		}
		if (Math.abs(ahead) <= step + 1e-9) {
			this.position = goal;
		} else {
			const next = this.position + Math.sign(ahead) * step;
			this.position = this.looping ? ((next % this.length) + this.length) % this.length : next;
		}
	}

	private stationAt(position: number): number {
		return this.at.findIndex((place) => Math.abs(place - position) < 1e-9);
	}

	/** What the arm does when it's down at a station. */
	private act(station: number, tick: number): void {
		const hand = this.hand;
		if (this.bins.has(station)) {
			if (hand && !this.binHolds.has(station)) {
				this.delivered.push({ station, tick, ...hand });
				if (this.jammed) this.binHolds.set(station, hand);
				this.hand = undefined;
			}
		} else if (this.planters.has(station)) {
			const plant = this.planters.get(station) ?? null;
			if (!plant) {
				const grows = hand && this.seeds.get(hand.item);
				if (hand && grows) {
					this.planters.set(station, { ...grows, mature: false, seeding: false, seeds: 0, harvest: 0 });
					this.take(1);
				}
			} else {
				const produce = willHarvest(plant);
				if (!hand) {
					if (produce) this.harvest(station, plant);
					else this.planters.set(station, null);
				} else if (produce) {
					if (hand.item === produce && hand.quantity < this.stackSize) {
						this.harvest(station, plant);
					} else if (!this.extra) {
						this.extra = hand;
						this.hand = undefined;
						this.harvest(station, plant);
					}
				}
			}
		}
		if (!this.hand && this.extra) {
			this.hand = this.extra;
			this.extra = undefined;
		}
	}

	/** Take one item from the plant into the hand, and clear the planter if that was the last. */
	private harvest(station: number, plant: Plant): void {
		let item: string;
		if (plant.seeding && plant.seeds > 0) {
			plant.seeds--;
			item = plant.seed;
		} else {
			plant.harvest--;
			item = plant.fruit;
		}
		if (this.hand) this.hand.quantity++;
		else this.hand = { item, quantity: 1 };
		if (plant.harvest <= 0 && (!plant.seeding || plant.seeds <= 0)) {
			if (plant.perennial) Object.assign(plant, { mature: false, seeding: false });
			else this.planters.set(station, null);
		}
	}

	private take(quantity: number): void {
		if (!this.hand) return;
		this.hand.quantity -= quantity;
		if (this.hand.quantity <= 0) this.hand = undefined;
	}

	private show(device: DeviceHandle): void {
		putStack(device, HAND, this.hand);
		putStack(device, EXTRA, this.extra);
		const station = this.station;
		const target = device.slot(TARGET);
		target.clear();
		let slotIndex = -1;
		let prefab = 0;
		if (this.planters.has(station)) {
			[slotIndex, prefab] = [0, PLANTER_HASH];
			const plant = this.planters.get(station);
			if (plant) {
				target.put(plant.item, {
					Class: PLANT_CLASS,
					Mature: plant.mature ? 1 : 0,
					Seeding: plant.seeding ? (plant.seeds > 0 ? 1 : 0) : -1,
				});
			}
		} else if (this.bins.has(station)) {
			[slotIndex, prefab] = [0, BIN_HASH];
			const held = this.binHolds.get(station);
			if (held) target.put(held.item, { Quantity: held.quantity });
		}
		device.set("TargetSlotIndex", slotIndex).set("TargetPrefabHash", prefab);
	}
}

/** The game's `Plant.WillHarvest`: what one harvest gives, or undefined. */
function willHarvest(plant: Plant): string | undefined {
	if (plant.seeding && plant.seeds > 0) return plant.seed;
	if ((plant.seeding || plant.mature) && plant.harvest > 0) return plant.fruit;
	return undefined;
}

function putStack(device: DeviceHandle, index: number, stack: LarreStack | undefined): void {
	if (stack) device.slot(index).put(stack.item, { Quantity: stack.quantity });
	else device.slot(index).clear();
}

function wrap(value: number, count: number): number {
	return ((value % count) + count) % count;
}
