/**
 * The logic behind each matcher, as plain functions: they take the subject and expectation and
 * return whether it passed plus a message, so they work outside Vitest too. `vitest.ts` wraps them
 * with `expect.extend`.
 */
import type { Ic10Error } from "@stationeers-ic/ic10";
import type { Change, Snapshot } from "../world/snapshot.ts";
import { Recording } from "../world/snapshot.ts";
import { ChipHandle, DeviceHandle, World } from "../world/world.ts";
import { chipReport, deviceReport, formatValue, worldReport } from "./report.ts";

/** How a check compares values and whether it's negated (`.not`). */
export interface MatchContext {
	/** The assertion is negated: the message should explain why it passed. */
	isNot?: boolean;
	/** Equality; Vitest passes its own, which understands asymmetric matchers like `expect.closeTo`. */
	equals?: (actual: unknown, expected: unknown) => boolean;
}

export interface MatchResult {
	pass: boolean;
	message: () => string;
	actual?: unknown;
	expected?: unknown;
}

/** `Object.is`, but 0 equals -0, arrays compare by element, and asymmetric matchers are honoured. */
export function defaultEquals(actual: unknown, expected: unknown): boolean {
	if (isAsymmetric(expected)) return expected.asymmetricMatch(actual);
	if (Array.isArray(actual) && Array.isArray(expected)) {
		return actual.length === expected.length && actual.every((a, i) => defaultEquals(a, expected[i]));
	}
	return actual === expected || Object.is(actual, expected);
}

function isAsymmetric(value: unknown): value is { asymmetricMatch(other: unknown): boolean } {
	return typeof value === "object" && value !== null && typeof (value as { asymmetricMatch?: unknown }).asymmetricMatch === "function";
}

function show(value: unknown, world?: World): string {
	if (isAsymmetric(value)) return String((value as { toString(): string }).toString());
	if (Array.isArray(value)) return `[${value.map((v) => show(v, world)).join(", ")}]`;
	if (value === undefined) return "unset";
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value).map(([key, v]) => `${key}: ${show(v, world)}`);
		return `{ ${entries.join(", ")} }`;
	}
	return formatValue(value, world);
}

function result(pass: boolean, headline: () => string, report: () => string, extra?: object): MatchResult {
	return { pass, message: () => `${headline()}\n\n${report()}`, ...extra };
}

const not = (ctx: MatchContext) => (ctx.isNot ? "not " : "");
const equalsOf = (ctx: MatchContext) => ctx.equals ?? defaultEquals;

function requireChip(subject: unknown, matcher: string): ChipHandle {
	if (subject instanceof ChipHandle) return subject;
	throw new TypeError(`${matcher}: expected a chip, e.g. expect(world.chip("ic")), but got ${describeSubject(subject)}`);
}

function describeSubject(subject: unknown): string {
	if (subject instanceof DeviceHandle) return `device "${subject.key}"`;
	if (subject instanceof World) return "the world";
	if (subject instanceof Recording) return `a recording of "${subject.path}"`;
	return subject === null ? "null" : typeof subject;
}

function registerLabel(chip: ChipHandle, name: string): { index: number; label: string } {
	const index = chip.registerIndex(name);
	const raw = `r${index}`;
	const aliases = chip.aliases()[raw] ?? [];
	const label = name === raw ? (aliases.length ? `${raw} (${aliases.join(", ")})` : raw) : `${name} (${raw})`;
	return { index, label };
}

// --- devices ---------------------------------------------------------------------------------------

/** The device (or a chip's housing) has these property values. Other properties aren't checked. */
export function checkProps(subject: unknown, expected: Record<string, unknown>, ctx: MatchContext = {}): MatchResult {
	const device = subject instanceof ChipHandle ? subject.db : subject;
	if (!(device instanceof DeviceHandle)) {
		throw new TypeError(`toHaveProps: expected a device, e.g. expect(world.device("vent")), but got ${describeSubject(subject)}`);
	}
	const equals = equalsOf(ctx);
	const actual: Record<string, unknown> = {};
	const rows: string[] = [];
	let pass = true;
	for (const [name, want] of Object.entries(expected)) {
		let got: number;
		try {
			got = device.get(name);
		} catch {
			pass = false;
			actual[name] = undefined;
			rows.push(`  ✗ ${name}: ${device.prefab} has no such property`);
			continue;
		}
		actual[name] = got;
		const ok = equals(got, want);
		if (!ok) pass = false;
		rows.push(ok ? `  ✓ ${name} = ${show(got)}` : `  ✗ ${name} = ${show(got)}, expected ${show(want)}`);
	}
	return result(
		pass,
		() => `expected device "${device.key}" ${not(ctx)}to have ${show(expected)}\n${rows.join("\n")}`,
		() => `${deviceReport(device)}\n\n${worldReport(device.world)}`,
		{ actual, expected },
	);
}

// --- registers and stack -----------------------------------------------------------------------------

/** A register, by raw name (`r15`, `sp`, `ra`) or by an alias the script defined, has this value. */
export function checkRegister(subject: unknown, name: string, expected: unknown, ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toHaveRegister");
	if (!chip.hasRegister(name)) return noSuchRegister(chip, name, ctx);
	const { index, label } = registerLabel(chip, name);
	const actual = chip.reg(name);
	return result(
		equalsOf(ctx)(actual, expected),
		() => `expected chip "${chip.key}" register ${label} ${not(ctx)}to be ${show(expected, chip.world)}, but it is ${show(actual, chip.world)}`,
		() => chipReport(chip, { registers: [index] }),
		{ actual, expected },
	);
}

/** A register is within `10^-digits / 2` of `expected` (like `toBeCloseTo`; default 2 digits). */
export function checkRegisterCloseTo(
	subject: unknown,
	name: string,
	expected: number,
	digits = 2,
	ctx: MatchContext = {},
): MatchResult {
	const chip = requireChip(subject, "toHaveRegisterCloseTo");
	if (!chip.hasRegister(name)) return noSuchRegister(chip, name, ctx);
	const { index, label } = registerLabel(chip, name);
	const actual = chip.reg(name);
	const tolerance = 10 ** -digits / 2;
	const pass =
		actual === expected || (Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < tolerance);
	return result(
		pass,
		() =>
			`expected chip "${chip.key}" register ${label} ${not(ctx)}to be within ${tolerance} of ${expected}, but it is ${show(actual)}`,
		() => chipReport(chip, { registers: [index] }),
		{ actual, expected },
	);
}

function noSuchRegister(chip: ChipHandle, name: string, ctx: MatchContext): MatchResult {
	const aliases = Object.values(chip.aliases())
		.flat()
		.filter((alias) => alias !== "sp" && alias !== "ra");
	return result(
		false,
		() =>
			`chip "${chip.key}" has no register or alias "${name}" (aliases defined so far: ${aliases.join(", ") || "none"}). ` +
			"Aliases are case-sensitive and only exist once the script has run its alias line.",
		() => chipReport(chip),
	);
}

/** The stack below `sp` (what has been pushed) is exactly `expected`. */
export function checkStack(subject: unknown, expected: unknown[], ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toHaveStack");
	const actual = chip.stack();
	return result(
		equalsOf(ctx)(actual, expected),
		() => `expected chip "${chip.key}" ${not(ctx)}to have stack ${show(expected)}, but it has ${show(actual)}`,
		() => chipReport(chip),
		{ actual, expected },
	);
}

/** One stack entry (whatever `sp` is: what `get` / `put` address) has this value. */
export function checkStackAt(subject: unknown, index: number, expected: unknown, ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toHaveStackAt");
	const actual = chip.stackAt(index);
	return result(
		equalsOf(ctx)(actual, expected),
		() =>
			`expected chip "${chip.key}" stack[${index}] ${not(ctx)}to be ${show(expected, chip.world)}, but it is ${show(actual, chip.world)}`,
		() => chipReport(chip),
		{ actual, expected },
	);
}

// --- where the chip is -------------------------------------------------------------------------------

/** The chip runs this line next (or halted on it): an index (0-based) or a label. */
export function checkLine(subject: unknown, target: number | string, ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toBeAtLine");
	const line = typeof target === "number" ? target : chip.findLabel(target);
	if (line === undefined) {
		return result(false, () => `chip "${chip.key}" has no label "${target}"`, () => chipReport(chip));
	}
	const where = typeof target === "string" ? `label ${target} (line ${line})` : `line ${line}`;
	const text = (index: number) => JSON.stringify(chip.lineText(index)?.trim() ?? "");
	return result(
		chip.line === line,
		() =>
			`expected chip "${chip.key}" ${not(ctx)}to be at ${where} ${text(line)}, but it is at line ${chip.line} ${text(chip.line)}`,
		() => chipReport(chip),
		{ actual: chip.line, expected: line },
	);
}

// --- errors and halts --------------------------------------------------------------------------------

export type Severity = "weak" | "warning" | "strong" | "critical";
const SEVERITY_ORDER: Severity[] = ["weak", "warning", "strong", "critical"];

export interface NoErrorsOptions {
	/** Least severe error that counts. Default `"warning"`, which includes reading a property a device doesn't have. */
	severity?: Severity;
}

/** The chip hasn't halted and has recorded no errors at or above `severity`. */
export function checkNoErrors(subject: unknown, options: NoErrorsOptions = {}, ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toHaveNoErrors");
	const min = SEVERITY_ORDER.indexOf(options.severity ?? "warning");
	const errors = chip.errors.filter((e) => SEVERITY_ORDER.indexOf(e.severity) >= min);
	const pass = errors.length === 0 && !chip.halted;
	return result(
		pass,
		() => {
			if (ctx.isNot) return `expected chip "${chip.key}" to have errors, but it has none at or above "${SEVERITY_ORDER[min]}"`;
			const head = chip.halted ? `expected chip "${chip.key}" to have no errors, but it halted` : `expected chip "${chip.key}" to have no errors`;
			return `${head}\n${formatErrors(chip, errors)}`;
		},
		() => chipReport(chip),
	);
}

/** Errors as `line N "source": severity: message`, collapsing repeats. */
function formatErrors(chip: ChipHandle, errors: readonly Ic10Error[]): string {
	const counts = new Map<string, number>();
	for (const error of errors) {
		const where = error.line === undefined ? "" : `line ${error.line} ${JSON.stringify(chip.lineText(error.line)?.trim() ?? "")}: `;
		const key = `${where}${error.severity}: ${error.message}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const shown = [...counts].slice(0, 10).map(([key, n]) => `  ${key}${n > 1 ? ` (×${n})` : ""}`);
	if (counts.size > 10) shown.push(`  … ${counts.size - 10} more`);
	return shown.join("\n");
}

export interface HaltExpectation {
	/** Line index (0-based) it halted on. */
	line?: number;
	/** The error message contains this, or matches this pattern. */
	error?: string | RegExp;
	/** The error's code, e.g. `"JUMP_LIMIT"`. */
	code?: string;
}

/** The chip halted on an error, optionally on this line and with a matching message. */
export function checkHalted(subject: unknown, expected: HaltExpectation = {}, ctx: MatchContext = {}): MatchResult {
	const chip = requireChip(subject, "toHaveHalted");
	const halt = chip.halt;
	const problems: string[] = [];
	if (halt) {
		if (expected.line !== undefined && halt.line !== expected.line) {
			problems.push(`it halted at line ${halt.line}, not ${expected.line} ${JSON.stringify(chip.lineText(expected.line)?.trim() ?? "")}`);
		}
		const message = halt.error.message;
		if (expected.error !== undefined) {
			const ok = typeof expected.error === "string" ? message.includes(expected.error) : expected.error.test(message);
			if (!ok) problems.push(`its error ${JSON.stringify(message)} doesn't match ${String(expected.error)}`);
		}
		if (expected.code !== undefined && halt.error.code !== expected.code) {
			problems.push(`its error code is ${JSON.stringify(halt.error.code)}, not ${JSON.stringify(expected.code)}`);
		}
	}
	const pass = halt !== null && problems.length === 0;
	const wanted = [
		expected.line !== undefined && `at line ${expected.line}`,
		expected.error !== undefined && `with an error matching ${String(expected.error)}`,
		expected.code !== undefined && `with code ${expected.code}`,
	].filter(Boolean);
	return result(
		pass,
		() => {
			const head = `expected chip "${chip.key}" ${not(ctx)}to have halted${wanted.length ? ` ${wanted.join(" ")}` : ""}`;
			if (!halt) return `${head}, but it ${chip.ended ? "ended without an error" : "is still running"}`;
			const why = problems.length ? `\n  ${problems.join("\n  ")}` : "";
			return `${head}, but it halted at line ${halt.line} in tick ${halt.tick}: ${halt.error.message}${why}`;
		},
		() => chipReport(chip),
	);
}

// --- changes over time -------------------------------------------------------------------------------

export interface OnlyChangeOptions {
	/** Snapshot to compare the world's current state with. Required when the subject is a World. */
	since?: Snapshot;
}

/**
 * Nothing changed apart from the given paths (`vent.On`, `ic.Stage`, `vent.*`). The subject is a
 * World with `{ since: snapshot }`, or the `Change[]` from `world.diff()`. A chip housing's
 * `LineNumber` is ignored unless listed.
 */
export function checkOnlyChange(
	subject: unknown,
	allowed: readonly string[],
	options: OnlyChangeOptions = {},
	ctx: MatchContext = {},
): MatchResult {
	let changes: Change[];
	let world: World | undefined;
	if (subject instanceof World) {
		if (!options.since) throw new TypeError("toOnlyChange: pass { since: snapshot } when the subject is a world");
		world = subject;
		changes = subject.diff(options.since);
	} else if (Array.isArray(subject)) {
		changes = subject as Change[];
	} else {
		throw new TypeError(`toOnlyChange: expected a world or world.diff(...), but got ${describeSubject(subject)}`);
	}

	const patterns = allowed.map((path) => {
		const canonical = world && !path.includes("*") ? world.canonicalPath(path) : path;
		const source = canonical.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
		return new RegExp(`^${source}$`);
	});
	// A housing's LineNumber moves with every line run, so it only counts when asked for.
	const chipKeys = world ? new Set(world.listChips().map((c) => c.key)) : undefined;
	const isLineNumber = (path: string) =>
		path.endsWith(".LineNumber") && (!chipKeys || chipKeys.has(path.slice(0, -".LineNumber".length)));
	const unexpected = changes.filter((c) => !patterns.some((p) => p.test(c.path)) && !isLineNumber(c.path));
	const label = (path: string) => {
		const match = world && /^(.*)\.(r\d+)$/.exec(path);
		if (!match) return path;
		const chip = world!.listChips().find((c) => c.key === match[1]);
		const aliases = chip?.aliases()[match[2]!];
		return aliases?.length ? `${path} (${aliases.join(", ")})` : path;
	};
	const row = (c: Change) => `  ${label(c.path)}: ${show(c.from)} → ${show(c.to)}`;
	return result(
		unexpected.length === 0,
		() =>
			ctx.isNot
				? `expected something besides ${allowed.join(", ")} to change, but only these did:\n${changes.map(row).join("\n") || "  (nothing)"}`
				: `expected only ${allowed.join(", ") || "nothing"} to change, but these did too:\n${unexpected.map(row).join("\n")}`,
		() => {
			const expectedChanges = changes.filter((c) => !unexpected.includes(c) && !isLineNumber(c.path));
			const rest = expectedChanges.length ? `allowed changes:\n${expectedChanges.map(row).join("\n")}` : "no allowed changes happened";
			return world ? `${rest}\n\n${worldReport(world)}` : rest;
		},
	);
}

/** A recorded value changed at most `n` times (see `world.record`). */
export function checkToggleAtMost(subject: unknown, n: number, ctx: MatchContext = {}): MatchResult {
	if (!(subject instanceof Recording)) {
		throw new TypeError(`toToggleAtMost: expected a recording, e.g. expect(world.record("vent.On")), but got ${describeSubject(subject)}`);
	}
	const changes = subject.changes;
	const first = subject.ticks[0] ?? 0;
	const last = subject.ticks.at(-1) ?? 0;
	return result(
		changes <= n,
		() =>
			`expected "${subject.path}" ${not(ctx)}to change at most ${n} times, but it changed ${changes} times over ticks ${first}–${last}`,
		() => `timeline (value at the end of each tick, where it changed):\n${formatTimeline(subject)}`,
		{ actual: changes, expected: n },
	);
}

function formatTimeline(recording: Recording): string {
	const out: string[] = [];
	for (let i = 0; i < recording.values.length; i++) {
		const value = recording.values[i];
		if (i > 0 && Object.is(value, recording.values[i - 1])) continue;
		out.push(`  tick ${String(recording.ticks[i]).padStart(5)}: ${show(value)}`);
	}
	if (out.length > 40) return [...out.slice(0, 20), `  … ${out.length - 40} more changes`, ...out.slice(-20)].join("\n");
	return out.join("\n");
}

// --- preemption ----------------------------------------------------------------------------------------

export interface AutoYieldOptions {
	/** Count within any window of this many consecutive ticks instead of over the whole run. */
	perTicks?: number;
}

/** The chip never used up its lines in a tick: every loop path reaches a `yield` or `sleep`. */
export function checkNeverAutoYield(subject: unknown, ctx: MatchContext = {}): MatchResult {
	return autoYields(requireChip(subject, "toNeverAutoYield"), 0, {}, ctx);
}

/** The chip was preempted at most `n` times (in total, or in any window of `perTicks` ticks). */
export function checkAutoYieldAtMost(subject: unknown, n: number, options: AutoYieldOptions = {}, ctx: MatchContext = {}): MatchResult {
	return autoYields(requireChip(subject, "toAutoYieldAtMost"), n, options, ctx);
}

function autoYields(chip: ChipHandle, n: number, options: AutoYieldOptions, ctx: MatchContext): MatchResult {
	const log = chip.autoYieldLog;
	const window = options.perTicks;
	if (window !== undefined && !(Number.isInteger(window) && window > 0)) {
		throw new TypeError(`toAutoYieldAtMost: perTicks must be a whole number of ticks, at least 1 (got ${window})`);
	}

	// The busiest window: for each auto-yield, count those within `window` ticks from it.
	let worst = { count: log.length, from: log[0]?.tick ?? 0, to: log.at(-1)?.tick ?? 0 };
	if (window !== undefined) {
		worst = { count: 0, from: 0, to: 0 };
		let end = 0;
		for (let start = 0; start < log.length; start++) {
			while (end < log.length && log[end]!.tick < log[start]!.tick + window) end++;
			if (end - start > worst.count) worst = { count: end - start, from: log[start]!.tick, to: log[start]!.tick + window - 1 };
		}
	}

	const scope = window === undefined ? "in total" : `per ${window} ticks`;
	const span = window === undefined ? `in ${chip.world.tick} ticks` : `in ticks ${worst.from}–${worst.to}`;
	return result(
		worst.count <= n,
		() =>
			n === 0 && window === undefined
				? ctx.isNot
					? `expected chip "${chip.key}" to auto-yield, but it never ran ${chip.linesPerTick} lines without a yield or sleep`
					: `expected chip "${chip.key}" never to auto-yield, but it ran ${chip.linesPerTick} lines without a yield or sleep ${times(log.length)} ${span}`
				: `expected chip "${chip.key}" ${not(ctx)}to auto-yield at most ${times(n)} ${scope}, but it auto-yielded ${times(worst.count)} ${span}`,
		() => {
			if (log.length === 0) return `never preempted\n\n${chipReport(chip)}`;
			const byLine = new Map<number, number>();
			for (const entry of log) byLine.set(entry.line, (byLine.get(entry.line) ?? 0) + 1);
			const where = [...byLine]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 8)
				.map(([line, count]) => `  after line ${line} ${JSON.stringify(chip.lineText(line)?.trim() ?? "")}: ${times(count)}`);
			const ticks = `${log.length > 10 ? "…, " : ""}${log.slice(-10).map((e) => e.tick).join(", ")}`;
			return `preempted:\n${where.join("\n")}\nin ticks: ${ticks}\n\n${chipReport(chip)}`;
		},
		{ actual: worst.count, expected: n },
	);
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);
