import { describe, expect, it } from "vitest";
import { findInlineValues, type InlineItem, resolveInlineValues } from "../src/inline-values.ts";

const SCRIPT = [
	"alias Stage r15 # the stage", // 0
	"alias Vent d0", // 1
	"define Max 5", // 2
	"loop:", // 3
	"l r0 Vent Temperature # r9 in a comment", // 4
	"s d1 On r0", // 5
	"add Stage Stage 1", // 6
	"blt Stage Max loop", // 7
	"move sp 0", // 8
].join("\n");

/** Each item as [line, what, the text it's shown for]. */
function described(text: string, lastLine: number) {
	const lines = text.split(/\r?\n/);
	return findInlineValues(text, lastLine).map((item) => {
		const what = item.kind === "value" ? item.expression : item.kind === "memory" ? `${item.device} ${item.index}` : item.kind;
		return [item.line, what, lines[item.line]!.slice(item.start, item.end)];
	});
}

describe("inline values: what to show", () => {
	it("shows registers, register aliases and device properties, each once a line, up to the line stopped at", () => {
		expect(described(SCRIPT, 7)).toEqual([
			[4, "r0", "r0"],
			[4, "Vent.Temperature", "Vent Temperature"],
			[5, "d1.On", "d1 On"],
			[5, "r0", "r0"],
			[6, "Stage", "Stage"],
			[7, "Stage", "Stage"],
		]);
	});

	it("skips alias and define lines, labels, defines, numbers and comments, and lines after the stop", () => {
		expect(described(SCRIPT, 3)).toEqual([]);
		expect(described(SCRIPT, 8).at(-1)).toEqual([8, "sp", "sp"]);
	});

	it("copes with CRLF line endings and a stop past the end", () => {
		expect(described("move r1 2\r\nyield", 99)).toEqual([[0, "r1", "r1"]]);
	});

	it("shows the entry put, get and poke address on every line, and push, pop and peek only where stopped", () => {
		const stack = ["alias Ctl d0", "push r1", "put db 10 3", "get r2 Ctl r1", "poke 4 r1", "pop r3", "peek r4"].join("\n");
		expect(described(stack, 5)).toEqual([
			[1, "r1", "r1"], // no "push": the stop is further down
			[2, "db 10", "10"],
			[3, "Ctl r1", "r1"],
			[3, "r2", "r2"],
			[3, "r1", "r1"],
			[4, "db 4", "4"],
			[4, "r1", "r1"],
			[5, "pop", "pop"],
			[5, "r3", "r3"],
		]);
		expect(described(stack, 1).slice(0, 1)).toEqual([[1, "push", "push"]]);
	});
});

describe("inline values: labels", () => {
	const at = { line: 0, start: 0, end: 1 };
	/** The debugger, with these values; anything else fails, as an undefined alias does. */
	const debuggerWith = (values: Record<string, string>) => async (expression: string) => {
		const value = values[expression];
		if (value === undefined) throw new Error(`"${expression}" isn't a register`);
		return value;
	};
	const labels = async (items: InlineItem[], values: Record<string, string>) =>
		(await resolveInlineValues(items, debuggerWith(values))).map((l) => l.text);

	it("says where push writes, and what it overwrites", async () => {
		expect(await labels([{ ...at, kind: "push" }], { sp: "2", "stack[2]": "0" })).toEqual(["push → stack[2]"]);
		expect(await labels([{ ...at, kind: "push" }], { sp: "2", "stack[2]": "7" })).toEqual(["push → stack[2], overwriting 7"]);
	});

	it("says what pop and peek read, or that the stack is empty", async () => {
		const values = { sp: "2", "stack[1]": "4097 (→ vent $1001)" };
		expect(await labels([{ ...at, kind: "pop" }], values)).toEqual(["pop ← stack[1] = 4097 (→ vent $1001)"]);
		expect(await labels([{ ...at, kind: "peek" }], values)).toEqual(["peek stack[1] = 4097 (→ vent $1001)"]);
		expect(await labels([{ ...at, kind: "pop" }], { sp: "0" })).toEqual(["pop: the stack is empty"]);
	});

	it("shows the entry put or get addresses, on the chip or another device", async () => {
		const items: InlineItem[] = [
			{ ...at, kind: "memory", device: "db", index: "10" },
			{ ...at, kind: "memory", device: "Ctl", index: "r1" },
		];
		expect(await labels(items, { "10": "10", "stack[10]": "3", r1: "0", "Ctl.stack[0]": "5" })).toEqual([
			"stack[10] = 3",
			"Ctl.stack[0] = 5",
		]);
	});

	it("shows registers as name = value, and leaves out what can't be evaluated", async () => {
		const items: InlineItem[] = [
			{ ...at, kind: "value", expression: "Stage" },
			{ ...at, kind: "value", expression: "r0" },
		];
		expect(await labels(items, { r0: "1" })).toEqual(["r0 = 1"]);
	});
});
