import { type CatalogSlot, loadCatalog, prefabInfo } from "../catalog/catalog.ts";
import { formatValue } from "../matchers/report.ts";
import { formatSeconds } from "../scheduler/time.ts";
import type { AtmosphereEntry } from "../world/atmospheres.ts";
import { atmosphereValues, type ChipHandle, type DeviceHandle, MirrorHandle, type World } from "../world/world.ts";
import { deviceKeyFor, evaluate } from "./evaluate.ts";
import type { ScopeInfo, VariableInfo } from "./protocol.ts";

/** A row in the Variables panel, before it's given a ref. */
interface Node {
	name: string;
	value: string;
	children?: () => Node[];
	/** Change the value from the user's text; returns the new value as shown. */
	set?: (text: string) => string;
	evaluateName?: string;
}

const PINS = ["d0", "d1", "d2", "d3", "d4", "d5"] as const;

/**
 * The Variables panel's contents for a stopped chip: each scope and row with children gets a ref,
 * good until `reset()` (when the run carries on).
 */
export class Inspector {
	/** Each ref's rows, and the chip they were asked for from (whose names an expression uses). */
	private readonly refs = new Map<number, { chip: ChipHandle; children: () => Node[] }>();
	private next = 1;

	reset(): void {
		this.refs.clear();
		this.next = 1;
	}

	scopes(chip: ChipHandle): ScopeInfo[] {
		const scopes: [string, () => Node[]][] = [
			["Registers", () => registers(chip)],
			["Stack", () => stack(chip)],
			["Devices", () => devices(chip)],
		];
		if (chip.world.listAtmospheres().length > 0) scopes.push(["Atmospheres", () => atmospheres(chip.world)]);
		scopes.push(["World", () => worldRows(chip)], ["Defines", () => defines(chip)]);
		return scopes.map(([name, children]) => ({ name, ref: this.add(chip, children) }));
	}

	variables(ref: number): VariableInfo[] {
		const { chip, children } = this.entry(ref);
		return children().map((node) => this.info(chip, node));
	}

	setVariable(ref: number, name: string, text: string): VariableInfo {
		const { chip, node } = this.findNode(ref, name);
		if (!node.set) throw new Error(`${name} can't be changed here`);
		return { ...this.info(chip, node), value: node.set(text) };
	}

	/** The row `name` under `ref` (its name and what `evaluate` reads for it), and the chip it was asked for from. */
	find(ref: number, name: string): { chip: ChipHandle; node: { name: string; evaluateName?: string } } {
		const { chip, node } = this.findNode(ref, name);
		return { chip, node: { name: node.name, ...(node.evaluateName !== undefined && { evaluateName: node.evaluateName }) } };
	}

	private findNode(ref: number, name: string): { chip: ChipHandle; node: Node } {
		const { chip, children } = this.entry(ref);
		const node = children().find((n) => n.name === name);
		if (!node) throw new Error(`no "${name}" here any more`);
		return { chip, node };
	}

	/** An expression's value, with rows to expand when it names a device or a pipe or room. */
	evaluate(chip: ChipHandle, expression: string, context?: string): VariableInfo {
		const expr = expression.trim();
		const key = safely(() => deviceKeyFor(chip, expr));
		if (key !== undefined) return this.info(chip, deviceNode(chip, chip.world.device(key), expr));
		const atmosphere = chip.world.listAtmospheres().find((a) => a.key === expr);
		if (atmosphere) return this.info(chip, atmosphereNode(atmosphere));
		try {
			return { name: expr, value: formatValue(evaluate(chip, expr), chip.world), ref: 0 };
		} catch (error) {
			const description = context === "hover" ? describeLogicType(expr) : undefined;
			if (description) return { name: expr, value: description, ref: 0 };
			throw error;
		}
	}

	private entry(ref: number): { chip: ChipHandle; children: () => Node[] } {
		const entry = this.refs.get(ref);
		if (!entry) throw new Error(`no variables ${ref} (they last until the run carries on)`);
		return entry;
	}

	private add(chip: ChipHandle, children: () => Node[]): number {
		const ref = this.next++;
		this.refs.set(ref, { chip, children });
		return ref;
	}

	private info(chip: ChipHandle, node: Node): VariableInfo {
		return {
			name: node.name,
			value: node.value,
			ref: node.children ? this.add(chip, node.children) : 0,
			...(node.evaluateName !== undefined && { evaluateName: node.evaluateName }),
			...(!node.set && { readOnly: true }),
		};
	}
}

function registers(chip: ChipHandle): Node[] {
	const aliases = chip.aliases();
	return Object.entries(chip.registers()).map(([reg, value]) => {
		const names = aliases[reg] ?? [];
		return {
			name: names.length > 0 ? `${reg} (${names.join(", ")})` : reg,
			value: formatValue(value, chip.world),
			evaluateName: reg,
			set: (text) => {
				chip.setReg(reg, evaluate(chip, text));
				return formatValue(chip.reg(reg), chip.world);
			},
		};
	});
}

/** Entries below `sp`, the top marked, then any above it that hold something (what `put` wrote). */
function stack(chip: ChipHandle): Node[] {
	const sp = Math.min(Math.max(0, Math.floor(chip.sp)), chip.stackLength);
	const indices = Array.from({ length: sp }, (_, i) => i);
	for (let i = sp; i < chip.stackLength; i++) if (chip.stackAt(i) !== 0) indices.push(i);
	return indices.map((i) => ({
		name: i === sp - 1 ? `${i} (top)` : i >= sp ? `${i} (above sp)` : String(i),
		value: formatValue(chip.stackAt(i), chip.world),
		evaluateName: `stack[${i}]`,
		set: (text: string) => {
			chip.setStackAt(i, evaluate(chip, text));
			return formatValue(chip.stackAt(i), chip.world);
		},
	}));
}

/** By pin, then `db`, then the rest of the chip's network. */
function devices(chip: ChipHandle): Node[] {
	const world = chip.world;
	const shown = new Set<string>();
	const out: Node[] = [];
	for (const pin of PINS) {
		const key = chip.pins[pin];
		if (key === undefined) continue;
		shown.add(key);
		out.push({ ...deviceNode(chip, world.device(key), pin), name: `${pin} → ${key}` });
	}
	shown.add(chip.key);
	out.push({ ...deviceNode(chip, chip.db, "db"), name: `db → ${chip.key}` });
	for (const device of world.network(chip.db.network).devices()) {
		if (!shown.has(device.key)) out.push(deviceNode(chip, device, device.key));
	}
	return out;
}

/** A device and its rows; `chip` is whose names a new value may use (`Max`, `$1488`). */
function deviceNode(chip: ChipHandle, device: DeviceHandle, expression: string): Node {
	return { name: device.key, value: describeDevice(device), children: () => deviceRows(chip, device, expression) };
}

/** `StructureActiveVent $1001 "Night Vent"` */
function describeDevice(device: DeviceHandle): string {
	const name = device.name !== device.prefab ? ` "${device.name}"` : "";
	return `${device.prefab} ${device.idHex}${name}`;
}

function deviceRows(chip: ChipHandle, device: DeviceHandle, expression: string): Node[] {
	const world = chip.world;
	const rows: Node[] = [
		{ name: "id", value: `${device.idHex} (${device.id})` },
		{ name: "prefab", value: device.prefab },
		{ name: "name", value: device.name },
		{ name: "network", value: device.network },
	];
	if (device instanceof MirrorHandle) {
		const target = device.target;
		rows.push(
			target
				? { ...deviceNode(chip, target, target.key), name: "target", value: `${target.key} (${target.network})` }
				: { name: "target", value: "none" },
			{ name: "powered", value: String(device.powered) },
		);
		return rows;
	}
	const readings = new Set(device.readings);
	const props = device.props();
	for (const prop of Object.keys(props).sort()) {
		rows.push({
			name: prop,
			value: formatValue(props[prop], world),
			evaluateName: `${expression}.${prop}`,
			...(!readings.has(prop) && {
				set: (text: string) => {
					device.set(prop, evaluate(chip, text));
					return formatValue(device.get(prop), world);
				},
			}),
		});
	}
	const slots = prefabInfo(device.prefab)?.slots ?? [];
	if (slots.length > 0) rows.push({ name: "slots", value: `${slots.length}`, children: () => slotRows(device, slots) });
	return rows;
}

function slotRows(device: DeviceHandle, slots: CatalogSlot[]): Node[] {
	return slots.map((slot) => {
		const handle = device.slot(slot.index);
		const occupied = handle.occupied;
		return {
			name: `${slot.index} ${slot.name}`,
			value: occupied ? `Quantity ${handle.get("Quantity")}, OccupantHash ${handle.get("OccupantHash")}` : "empty",
			children: () =>
				slot.logic.map((logic) => ({
					name: logic,
					value: String(safely(() => handle.get(logic)) ?? "—"),
					...(handle.occupied && {
						set: (text: string) => {
							handle.set(logic, Number(text));
							return String(handle.get(logic));
						},
					}),
				})),
		};
	});
}

function atmospheres(world: World): Node[] {
	return world.listAtmospheres().map(atmosphereNode);
}

function atmosphereNode(entry: AtmosphereEntry): Node {
	const values = atmosphereValues(entry);
	const volume = entry.atmosphere.volume;
	const kind = volume === Infinity ? "outside" : `${entry.kind} ${round(volume)} L`;
	return {
		name: entry.key,
		value: `${kind}: ${round(values.Pressure!)} kPa, ${round(values.Temperature!)} K`,
		children: () =>
			Object.entries(values).map(([name, value]) => ({ name, value: round(value), evaluateName: `${entry.key}.${name}` })),
	};
}

function worldRows(chip: ChipHandle): Node[] {
	const world = chip.world;
	const events = world.listEvents();
	const models = world.listModels();
	const rows: Node[] = [
		{ name: "tick", value: String(world.tick) },
		{ name: "time", value: formatSeconds(world.time) },
		{ name: "status", value: chip.status },
		{ name: "lines this tick", value: `${chip.linesThisTick} of ${chip.linesPerTick}` },
		{ name: "auto-yields", value: String(chip.autoYields) },
	];
	if (chip.sleepUntil !== null) rows.push({ name: "sleeping until", value: formatSeconds(chip.sleepUntil) });
	rows.push(
		{
			name: "events",
			value: `${events.length} to come`,
			children: () =>
				events.map((e) => ({
					name: e.label,
					value:
						e.kind === "when"
							? "when its condition becomes true"
							: `tick ${e.nextTick}${e.interval !== undefined ? `, then every ${e.interval}` : ""}`,
				})),
		},
		{
			name: "models",
			value: String(models.length),
			children: () => models.map((label, i) => ({ name: String(i), value: label })),
		},
	);
	return rows;
}

function defines(chip: ChipHandle): Node[] {
	return chip.defines().map((d) => ({
		name: d.name,
		value: d.kind === "label" ? `label, line ${Number(d.value) + 1}` : d.kind === "alias" ? `alias ${d.value}` : d.value,
		evaluateName: d.name,
	}));
}

/** A logic type's description from the catalogue, for hovers on `On`, `Setting`, … */
function describeLogicType(name: string): string | undefined {
	const catalog = safely(() => loadCatalog());
	const description = catalog?.logicTypes[name] ?? catalog?.slotLogicTypes[name];
	return description ? `${name}: ${description.text}` : undefined;
}

function round(value: number): string {
	return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : String(value);
}

function safely<T>(get: () => T): T | undefined {
	try {
		return get();
	} catch {
		return undefined;
	}
}
