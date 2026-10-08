/** Every device property and chip register at one moment, by path (`vent.On`, `ic.r15`). */
export interface Snapshot {
	tick: number;
	values: Record<string, number>;
}

/** One value that differs between two snapshots. */
export interface Change {
	path: string;
	/** undefined when the property had no value in that snapshot. */
	from: number | undefined;
	to: number | undefined;
}

/** What changed from `before` to `after`, sorted by path. NaN counts as equal to NaN. */
export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
	const paths = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
	const out: Change[] = [];
	for (const path of [...paths].sort()) {
		const from = before.values[path];
		const to = after.values[path];
		if (!same(from, to)) out.push({ path, from, to });
	}
	return out;
}

/** One value sampled when recording starts and again at the end of every tick. */
export class Recording {
	/** The sampled values: the first is from when recording started. */
	readonly values: number[] = [];
	/** The tick count at each sample (ticks completed). */
	readonly ticks: number[] = [];

	/** What is recorded: a path such as `vent.On`, or `<fn>` for a function. */
	readonly path: string;
	private readonly read: () => number;

	constructor(path: string, read: () => number) {
		this.path = path;
		this.read = read;
	}

	/** @internal Take a sample. */
	sample(tick: number): void {
		this.values.push(this.read());
		this.ticks.push(tick);
	}

	/** How many times the value changed between consecutive samples. */
	get changes(): number {
		let count = 0;
		for (let i = 1; i < this.values.length; i++) {
			if (!same(this.values[i], this.values[i - 1])) count++;
		}
		return count;
	}
}

/** Equal, treating NaN as equal to itself. */
function same(a: number | undefined, b: number | undefined): boolean {
	return a === b || Object.is(a, b);
}
