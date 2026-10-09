import { formatReport, formatTrace } from "../scheduler/errors.ts";
import { formatSeconds } from "../scheduler/time.ts";
import type { ChipHandle, DeviceHandle, World } from "../world/world.ts";

/** Lines of a chip's own trace a report shows. */
const REPORT_LINES = 12;
/** Stack entries a report shows. */
const STACK_ENTRIES = 16;
/** Width at which a device's property list wraps. */
const WRAP = 100;

/** A number as the game would show it, plus the device it names when it's a reference ID. */
export function formatValue(value: unknown, world?: World): string {
	if (typeof value !== "number") return String(value);
	const text = Number.isNaN(value) ? "NaN" : String(value);
	const device = world && Number.isInteger(value) && value > 0 ? world.deviceById(value) : undefined;
	return device ? `${text} (→ ${device.key} ${device.idHex})` : text;
}

/** `vent  StructureActiveVent $1001 "Night Vent" on data` */
export function describeDevice(device: DeviceHandle): string {
	const name = device.name !== device.prefab ? ` "${device.name}"` : "";
	const network = device.network ? ` on ${device.network}` : "";
	return `${device.key}  ${device.prefab} ${device.idHex}${name}${network}`;
}

/** A device's properties that have values, `Name=value`, wrapped and indented. */
export function formatProps(props: Record<string, number>, indent: string): string[] {
	const items = Object.keys(props)
		.sort()
		.map((name) => `${name}=${formatValue(props[name])}`);
	if (items.length === 0) return [`${indent}(no properties set)`];
	const out: string[] = [];
	let line = "";
	for (const item of items) {
		if (line && indent.length + line.length + 1 + item.length > WRAP) {
			out.push(indent + line);
			line = item;
		} else {
			line = line ? `${line} ${item}` : item;
		}
	}
	out.push(indent + line);
	return out;
}

/** A device and every property it has a value for. */
export function deviceReport(device: DeviceHandle): string {
	return [`device ${describeDevice(device)}`, ...formatProps(device.props(), "    ")].join("\n");
}

/** Registers that are non-zero or aliased (and any in `always`), with their aliases. */
export function formatRegisters(chip: ChipHandle, always: readonly number[] = []): string[] {
	const aliases = chip.aliases();
	const values = chip.registers();
	const rows: [string, string, string][] = [];
	let hidden = 0;
	for (const [reg, value] of Object.entries(values)) {
		const names = aliases[reg] ?? [];
		const index = Number(reg.slice(1));
		if (value === 0 && names.length === 0 && !always.includes(index)) {
			hidden++;
			continue;
		}
		rows.push([reg, names.join(", "), formatValue(value, chip.world)]);
	}
	const regWidth = Math.max(...rows.map((r) => r[0].length), 3);
	const nameWidth = Math.max(...rows.map((r) => r[1].length), 0);
	const out = rows.map(([reg, names, value]) => `    ${reg.padEnd(regWidth)}  ${names.padEnd(nameWidth)}  ${value}`);
	if (hidden > 0) out.push(`    (${hidden} other registers are 0)`);
	return out;
}

/** The stack below `sp`. */
export function formatStack(chip: ChipHandle): string {
	const stack = chip.stack();
	if (stack.length === 0) return `stack: empty (sp ${formatValue(chip.sp)})`;
	const shown = stack.slice(0, STACK_ENTRIES).map((v) => formatValue(v, chip.world));
	const more = stack.length > STACK_ENTRIES ? `, … ${stack.length - STACK_ENTRIES} more` : "";
	return `stack (sp ${formatValue(chip.sp)}): [${shown.join(", ")}${more}]`;
}

export interface ChipReportOptions {
	/** Register indices to show even when they're 0 and unaliased. */
	registers?: readonly number[];
	/** Leave out the devices on the chip's pins. */
	noDevices?: boolean;
}

/**
 * Everything about a chip a failing test needs: where it is (line and source), its registers with
 * their aliases, the stack, the devices on its pins and its housing, and the last lines it ran.
 */
export function chipReport(chip: ChipHandle, options: ChipReportOptions = {}): string {
	const world = chip.world;
	const out = [
		`chip "${chip.key}" [${chip.source}] at tick ${world.tick} (${formatSeconds(world.time)}): ${chip.status}`,
		"registers:",
		...formatRegisters(chip, options.registers),
		formatStack(chip),
	];
	if (!options.noDevices) {
		const pins = Object.entries(chip.pins);
		out.push("devices:");
		for (const [pin, key] of [...pins, ["db", chip.key] as const]) {
			const device = world.device(key);
			out.push(`  ${pin.padEnd(2)} → ${describeDevice(device)}`, ...formatProps(device.props(), "         "));
		}
	}
	const lines = chip.recentLines(REPORT_LINES);
	if (lines.length > 0) {
		out.push(`last ${lines.length} lines run by "${chip.key}":`, ...formatTrace(lines));
	}
	return out.join("\n");
}

/** Every chip's state and the last lines run across the world. */
export function worldReport(world: World): string {
	return formatReport(world.scheduler).replace(/^ {2}/, "world ");
}
