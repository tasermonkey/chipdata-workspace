/**
 * Static check of batch instructions (plan §6, use 3): for `lb`, `lbn`, `lbs`, `lbns`, `sb`, `sbn` and
 * `sbs` whose device type is a known prefab (`HASH("…")`, a number, or a define of either), check
 * that the prefab has the logic type, and that it can be read or written as the instruction does.
 *
 * A type held in a register, or a logic type given as a number, can't be known without running the
 * script, so those are skipped. So are names that aren't logic types at all: the emulator rejects
 * those when it loads the script.
 */
import type { CatalogPrefab } from "../catalog/catalog.ts";
import { hash } from "../engine/device.ts";

export type BatchOpProblem = "unknown-prefab" | "no-such-property" | "not-readable" | "not-writable" | "no-such-slot-property";

export interface BatchOpFinding {
	/** 0-based line. */
	line: number;
	text: string;
	prefab: string;
	logic: string;
	problem: BatchOpProblem;
	message: string;
}

/** The catalogue as the check needs it. */
export interface BatchOpCatalog {
	prefabs: Record<string, CatalogPrefab>;
}

interface Op {
	type: number;
	logic: number;
	access: "r" | "w";
	slot?: number;
}

/** Argument positions (after the opcode) of each batch instruction. */
const OPS: Record<string, Op> = {
	lb: { type: 1, logic: 2, access: "r" },
	lbn: { type: 1, logic: 3, access: "r" },
	lbs: { type: 1, slot: 2, logic: 3, access: "r" },
	lbns: { type: 1, slot: 3, logic: 4, access: "r" },
	sb: { type: 0, logic: 1, access: "w" },
	sbn: { type: 0, logic: 2, access: "w" },
	sbs: { type: 0, slot: 1, logic: 2, access: "w" },
};

/** A token: HASH("…") or STR("…") whole (they may hold spaces), or a run of non-blanks. */
const TOKEN = /(?:HASH|STR)\("[^"]*"\)|\S+/g;

function tokens(line: string): string[] {
	const code = line.replace(/(?:HASH|STR)\("[^"]*"\)|#.*/g, (m) => (m.startsWith("#") ? "" : m));
	return code.match(TOKEN) ?? [];
}

function parseNumber(token: string): number | undefined {
	if (/^-?\d+$/.test(token)) return Number(token);
	if (/^\$[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(1), 16) | 0;
	return undefined;
}

export function checkBatchOps(source: string, catalog: BatchOpCatalog): BatchOpFinding[] {
	const lines = source.split(/\r?\n/);
	const prefabs = Object.values(catalog.prefabs);
	const byHash = new Map(prefabs.map((p) => [p.hash, p]));
	const logicNames = new Set(prefabs.flatMap((p) => Object.keys(p.logic)));
	const slotLogicNames = new Set(prefabs.flatMap((p) => p.slots.flatMap((s) => s.logic)));

	// Defines apply to the whole script, wherever they are.
	const defines = new Map<string, string>();
	for (const line of lines) {
		const [op, name, value] = tokens(line);
		if (op === "define" && name && value) defines.set(name, value);
	}

	/** The prefab a type argument names: its name (known or not) and catalogue entry, if any. */
	const resolve = (token: string, depth = 0): { name: string; prefab?: CatalogPrefab } | undefined => {
		const hashed = /^HASH\("(.*)"\)$/.exec(token);
		if (hashed) {
			const name = hashed[1]!;
			return { name, prefab: catalog.prefabs[name] ?? byHash.get(hash(name)) };
		}
		const value = parseNumber(token);
		if (value !== undefined) {
			const prefab = byHash.get(value);
			return prefab ? { name: prefab.prefab, prefab } : { name: String(value) };
		}
		const defined = defines.get(token);
		return defined !== undefined && depth < 8 ? resolve(defined, depth + 1) : undefined; // a register or alias
	};

	const findings: BatchOpFinding[] = [];
	lines.forEach((text, line) => {
		const [opcode, ...args] = tokens(text);
		const op = opcode && OPS[opcode];
		if (!op) return;
		const type = resolve(args[op.type] ?? "");
		const logic = args[op.logic] ?? "";
		if (!type) return;
		const report = (problem: BatchOpProblem, message: string) =>
			findings.push({ line, text: text.trim(), prefab: type.name, logic, problem, message });

		if (!type.prefab) {
			// A number that isn't a prefab hash may be anything; a HASH() of an unknown name is a finding.
			if (/^HASH\(/.test(args[op.type]!) || defines.has(args[op.type]!)) {
				if (Number.isNaN(Number(type.name))) report("unknown-prefab", `no prefab ${type.name} in the catalogue`);
			}
			return;
		}
		const prefab = type.prefab;

		if (op.slot !== undefined) {
			if (!slotLogicNames.has(logic)) return; // not a slot logic type name: the emulator checks
			const slotIndex = parseNumber(args[op.slot] ?? "");
			const slots = slotIndex === undefined ? prefab.slots : prefab.slots.filter((s) => s.index === slotIndex);
			if (!slots.some((s) => s.logic.includes(logic))) {
				const where = slotIndex === undefined ? "any slot" : `slot ${slotIndex}`;
				report("no-such-slot-property", `${prefab.prefab} has no ${logic} in ${where}`);
			}
			return;
		}

		if (!logicNames.has(logic)) return; // not a logic type name (a define or a number): the emulator checks
		const access = prefab.logic[logic];
		if (!access) report("no-such-property", `${prefab.prefab} has no ${logic}`);
		else if (op.access === "r" && !access.includes("r")) report("not-readable", `${prefab.prefab}.${logic} can't be read`);
		else if (op.access === "w" && !access.includes("w")) report("not-writable", `${prefab.prefab}.${logic} is read-only`);
	});
	return findings;
}
