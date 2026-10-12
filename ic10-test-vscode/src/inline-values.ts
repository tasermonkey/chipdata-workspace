/**
 * What to show beside each line of an IC10 script while it's stopped (VS Code's inline values):
 * - the registers and register aliases a line uses, and the device property an `l` or `s` reads or
 *   writes (`Vent.On = 1`);
 * - for `put`, `get` and `poke`, the entry they address (`stack[10] = 3`, `d0.stack[0] = 5`);
 * - on the line stopped at only, where `push` writes (and what it overwrites) and what `pop` or
 *   `peek` reads. Elsewhere `sp` has moved on, so those would point at the wrong entry.
 * The values are the debugger's, now. No `vscode` import, so it can be tested on its own.
 */

/** Where on a line a value is shown for (`end` is exclusive). */
interface Place {
	/** 0-based line. */
	line: number;
	start: number;
	end: number;
}

/** Something to show on a line, before its value is known. */
export type InlineItem = Place &
	(
		| { kind: "value"; expression: string }
		| { kind: "push" | "pop" | "peek" }
		/** An entry of a device's memory: `device` is a pin or device alias (`db` for the chip's own stack). */
		| { kind: "memory"; device: string; index: string }
	);

/** A finished label. */
export interface InlineText extends Place {
	text: string;
}

const REGISTER = /^(r(1[0-7]|[0-9])|sp|ra)$/;
const PIN = /^(d[0-5]|db)$/;
const ALIAS = /^\s*alias\s+(\S+)\s+(\S+)/;
/** Instructions with a device and logic type: where they are among the arguments. */
const DEVICE_PROPERTY: Record<string, number> = { l: 1, s: 0 };
/** Instructions that address a device's memory: where the device and index are (no device: own stack). */
const MEMORY: Record<string, { device?: number; index: number }> = {
	put: { device: 0, index: 1 },
	get: { device: 1, index: 2 },
	poke: { index: 0 },
};
const STACK_TOP = new Set(["push", "pop", "peek"]);

/** What to show on lines `0` to `lastLine` (the line stopped at) of `text`, in order along each line. */
export function findInlineValues(text: string, lastLine: number): InlineItem[] {
	const lines = text.split(/\r?\n/);
	const registers = new Set<string>();
	const devices = new Set<string>();
	for (const source of lines) {
		const alias = ALIAS.exec(withoutComment(source));
		if (!alias) continue;
		if (REGISTER.test(alias[2]!)) registers.add(alias[1]!);
		else if (PIN.test(alias[2]!)) devices.add(alias[1]!);
	}
	const isDevice = (name: string) => PIN.test(name) || devices.has(name);

	const out: InlineItem[] = [];
	for (let line = 0; line <= Math.min(lastLine, lines.length - 1); line++) {
		const tokens = tokenize(withoutComment(lines[line]!));
		const [instruction, ...args] = tokens;
		if (!instruction || instruction.text.endsWith(":") || instruction.text === "alias" || instruction.text === "define") continue;
		const seen = new Set<string>();
		const value = (start: number, end: number, expression: string) => {
			if (seen.has(expression)) return;
			seen.add(expression);
			out.push({ kind: "value", line, start, end, expression });
		};

		if (STACK_TOP.has(instruction.text) && line === lastLine) {
			out.push({ kind: instruction.text as "push" | "pop" | "peek", line, start: instruction.start, end: instruction.end });
		}
		const memory = MEMORY[instruction.text];
		const indexToken = memory && args[memory.index];
		const deviceToken = memory?.device !== undefined ? args[memory.device] : undefined;
		if (memory && indexToken && (memory.device === undefined || (deviceToken && isDevice(deviceToken.text)))) {
			out.push({ kind: "memory", line, start: indexToken.start, end: indexToken.end, device: deviceToken?.text ?? "db", index: indexToken.text });
		}

		const at = DEVICE_PROPERTY[instruction.text];
		args.forEach((token, i) => {
			if (at !== undefined && i === at && args[i + 1]) {
				if (isDevice(token.text)) {
					const property = args[i + 1]!;
					value(token.start, property.end, `${token.text}.${property.text}`);
				}
				return;
			}
			if (at !== undefined && i === at + 1) return; // the logic type, shown with its device
			if (REGISTER.test(token.text) || registers.has(token.text)) value(token.start, token.end, token.text);
		});
	}
	return out;
}

/**
 * The labels for `items`, asking `evaluate` (the debugger, on the stopped chip) for values. An item
 * whose value can't be had (an alias not defined yet, an empty pin) is left out.
 */
export async function resolveInlineValues(
	items: InlineItem[],
	evaluate: (expression: string) => Promise<string>,
): Promise<InlineText[]> {
	const read = async (expression: string): Promise<string | undefined> => {
		try {
			return await evaluate(expression);
		} catch {
			return undefined;
		}
	};
	/** A value's number, ignoring a label after it (`4097 (→ vent $1001)`). */
	const number = (value: string | undefined) => (value === undefined ? undefined : Number.parseFloat(value));

	const labels = await Promise.all(
		items.map(async (item): Promise<InlineText | undefined> => {
			const place = { line: item.line, start: item.start, end: item.end };
			switch (item.kind) {
				case "value": {
					const value = await read(item.expression);
					return value === undefined ? undefined : { ...place, text: `${item.expression} = ${value}` };
				}
				case "push": {
					const sp = number(await read("sp"));
					if (sp === undefined) return undefined;
					const there = await read(`stack[${sp}]`);
					if (there === undefined) return { ...place, text: `push: the stack is full (sp = ${sp})` };
					return { ...place, text: `push → stack[${sp}]${number(there) !== 0 ? `, overwriting ${there}` : ""}` };
				}
				case "pop":
				case "peek": {
					const sp = number(await read("sp"));
					if (sp === undefined) return undefined;
					if (sp <= 0) return { ...place, text: `${item.kind}: the stack is empty` };
					const top = await read(`stack[${sp - 1}]`);
					if (top === undefined) return undefined;
					return { ...place, text: `${item.kind} ${item.kind === "pop" ? "← " : ""}stack[${sp - 1}] = ${top}` };
				}
				case "memory": {
					const index = number(await read(item.index));
					if (index === undefined) return undefined;
					const entry = item.device === "db" ? `stack[${index}]` : `${item.device}.stack[${index}]`;
					const value = await read(entry);
					return value === undefined ? undefined : { ...place, text: `${entry} = ${value}` };
				}
			}
		}),
	);
	return labels.filter((label): label is InlineText => label !== undefined);
}

function withoutComment(source: string): string {
	const hash = source.indexOf("#");
	return hash < 0 ? source : source.slice(0, hash);
}

function tokenize(source: string): { text: string; start: number; end: number }[] {
	return [...source.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}
