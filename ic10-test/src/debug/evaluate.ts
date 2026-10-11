import type { ChipHandle } from "../world/world.ts";

const PIN = /^(d[0-5]|db)$/;
const COMPARISON = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;

/**
 * The value of a name as a chip sees it, for breakpoint conditions, hovers and the debug console:
 * a number (`5`, `-1.5`, `$1488`, `%101`), a register or alias (`r15`, `Stage`, `sp`), a define
 * or label, or a device property by pin, device alias or key (`d0.On`, `vent.On`, `db.Setting`),
 * or any other world path (`coolant.Temperature`). Throws when it names nothing.
 */
export function evaluate(chip: ChipHandle, expression: string): number {
	const expr = expression.trim();
	const number = parseNumber(expr);
	if (number !== undefined) return number;
	if (chip.hasRegister(expr)) return chip.reg(expr);

	const define = chip.defines().find((d) => d.name === expr);
	if (define) {
		if (define.kind === "alias") throw new Error(`${expr} is the device ${define.value}; ask for one of its properties, e.g. ${expr}.On`);
		return Number(define.value);
	}

	const dot = expr.lastIndexOf(".");
	if (dot > 0) {
		const owner = expr.slice(0, dot);
		const key = deviceKeyFor(chip, owner) ?? owner;
		return chip.world.value(`${key}.${expr.slice(dot + 1)}`);
	}
	throw new Error(`"${expr}" isn't a register, alias, define, label or number`);
}

/**
 * Whether a breakpoint condition holds: a comparison (`Stage == 2`, `vent.Pressure > 100`) or a
 * single value, true when it's not 0.
 */
export function evaluateCondition(chip: ChipHandle, condition: string): boolean {
	const match = COMPARISON.exec(condition.trim());
	if (!match) return evaluate(chip, condition) !== 0;
	const [, left, op, right] = match;
	const a = evaluate(chip, left!);
	const b = evaluate(chip, right!);
	switch (op) {
		case "==":
			return a === b;
		case "!=":
			return a !== b;
		case ">=":
			return a >= b;
		case "<=":
			return a <= b;
		case ">":
			return a > b;
		default:
			return a < b;
	}
}

/** A log message with each `{expression}` replaced by its value (or the error, in brackets). */
export function interpolate(chip: ChipHandle, message: string): string {
	return message.replace(/\{([^{}]+)\}/g, (_, expr: string) => {
		try {
			return String(evaluate(chip, expr));
		} catch (error) {
			return `<${error instanceof Error ? error.message : String(error)}>`;
		}
	});
}

/**
 * The device a name stands for on this chip: a pin (`d0`, `db`), a device alias (`vent` for
 * `alias vent d0`) or a device's key. Undefined if it's none of those; throws for an empty pin.
 */
export function deviceKeyFor(chip: ChipHandle, name: string): string | undefined {
	const alias = chip.defines().find((d) => d.kind === "alias" && d.name === name);
	const pin = alias && PIN.test(alias.value) ? alias.value : name;
	if (pin === "db") return chip.key;
	if (PIN.test(pin)) {
		const key = chip.pins[pin];
		if (key === undefined) throw new Error(`nothing is on ${pin}`);
		return key;
	}
	return chip.world.listDevices().some((d) => d.key === name) ? name : undefined;
}

function parseNumber(text: string): number | undefined {
	if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number(text);
	const hex = /^\$([0-9a-f]+)$/i.exec(text);
	if (hex) return Number.parseInt(hex[1]!, 16);
	const bin = /^%([01]+)$/.exec(text);
	if (bin) return Number.parseInt(bin[1]!, 2);
	return undefined;
}
