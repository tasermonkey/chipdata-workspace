/**
 * The DS-8 furnace rack: every device on the I/O port its chips' `define`s name, and the chips in
 * their sockets. Each test fits only the chips it needs.
 */
import { sim, type World } from "@tasermonkey/ic10-bench";
import { type RackOptions, serverRack } from "@tasermonkey/ic10-bench-ds8";
import { readRepoScript, REPO_ROOT } from "../../support/paths.ts";
import { recipeCells } from "./recipes.ts";

const DIR = "ic10/DS8/FurnaceControl";

/** The chips, in socket order (socket = index + 1). */
export const CHIPS = {
	control: `${DIR}/Furnace Control.ic10`,
	release: `${DIR}/Furnace Release.ic10`,
	fuel: `${DIR}/Furnace Fuel Pump.ic10`,
	coolant: `${DIR}/Furnace Coolant Pump.ic10`,
	fuelMixer: `${DIR}/Furnace Fuel Mixer.ic10`,
	panel: `${DIR}/Furnace Panel.ic10`,
	status: `${DIR}/Furnace Status.ic10`,
	box: `${DIR}/Furnace Box.ic10`,
	readouts: `${DIR}/Furnace Readouts.ic10`,
	setup: `${DIR}/Furnace Recipes Setup.ic10`,
} as const;
export type ChipName = keyof typeof CHIPS;

/** A script's `define`s, by name. */
export function defines(script: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [, name, value] of readRepoScript(script).matchAll(/^define\s+(\w+)\s+(-?[\d.]+)/gm)) {
		out[name] = Number(value);
	}
	return out;
}

/** The I/O port whose device ID is at this rack address (ports 1-8 at 4128, 9-32 at 4160). */
export function portAt(address: number): number {
	return address >= 4160 ? address - 4151 : address - 4127;
}

/** Each device, and the chip and `define` that name its port. */
const DEVICES = {
	furnace: ["control", "FURNACE_PORT"],
	releaseLever: ["control", "RELEASE_PORT"],
	flushLever: ["release", "FLUSH_PORT"],
	fuelPump: ["fuel", "PUMP_PORT"],
	fuelPa: ["fuel", "ANALYZER_PORT"],
	coolantPump: ["coolant", "PUMP_PORT"],
	coolantPa: ["coolant", "ANALYZER_PORT"],
	mixer: ["fuelMixer", "MIXER_PORT"],
	o2Pa: ["fuelMixer", "O2_PA_PORT"],
	h2Pa: ["fuelMixer", "H2_PA_PORT"],
	ingotDial: ["panel", "INGOT_PORT"],
	amountDial: ["panel", "AMOUNT_PORT"],
	confirm: ["panel", "CONFIRM_PORT"],
	amountLed: ["panel", "AMOUNT_LED_PORT"],
	statusLed: ["status", "STATUS_LED_PORT"],
	statusLight: ["status", "STATUS_LIGHT_PORT"],
	pumpsLed: ["status", "PUMPS_LED_PORT"],
	ventLever: ["box", "LEVER_PORT"],
	ventOut: ["box", "VENT_OUT_PORT"],
	ventIn: ["box", "VENT_IN_PORT"],
	sensor: ["readouts", "SENSOR_PORT"],
	furnaceK: ["readouts", "FURNACE_K_PORT"],
	furnaceKpa: ["readouts", "FURNACE_KPA_PORT"],
	boxK: ["readouts", "BOX_K_PORT"],
	boxKpa: ["readouts", "BOX_KPA_PORT"],
} as const satisfies Record<string, readonly [ChipName, string]>;
export type DeviceName = keyof typeof DEVICES;

/** Each device's port, from the chip that names it. */
export const PORTS = Object.fromEntries(
	Object.entries(DEVICES).map(([device, [chip, define]]) => [device, portAt(defines(CHIPS[chip])[define])]),
) as Record<DeviceName, number>;

/** The rack's scratch cells and states, from Furnace Control (the Status chip names the pump cells). */
const control = defines(CHIPS.control);
const status = defines(CHIPS.status);
export const CELL = {
	state: control.STATE,
	request: control.REQUEST,
	target: control.TARGET,
	job: control.JOB,
	hold: control.HOLD,
	fuelOn: status.FUEL_ON,
	coolOn: status.COOL_ON,
} as const;
export const STATE = {
	idle: control.IDLE,
	ready: control.READY,
	held: control.HELD,
	noDisk: control.NODISK,
	active: control.ACTIVE,
	unloading: control.UNLOADING,
	emergency: control.EMERGENCY,
} as const;

export type Consoles = "vanilla" | "modular";
export type Readout = "display" | "ModularDeviceGauge2x2" | "ModularDeviceGauge3x3" | "ModularDeviceEdgewiseMeter3";

/** The console parts, each set using only what the scripts read and write. */
const CONSOLE_PARTS = {
	vanilla: {
		lever: "StructureLogicSwitch",
		cover: "StructureLogicSwitch2",
		button: "StructureLogicButton",
		dial: "StructureLogicDial",
		display: "StructureConsoleLED5",
		light: "StructureDiode",
	},
	modular: {
		lever: "ModularDeviceBigLever",
		cover: "ModularDeviceFlipCoverSwitch",
		button: "ModularDeviceRoundButton",
		dial: "ModularDeviceDial",
		display: "ModularDeviceLEDdisplay3",
		light: "ModularDeviceLight",
	},
} as const;

export interface RackSetup {
	/** The chips to fit, in their sockets. Default: all but the setup chip. */
	chips?: readonly ChipName[];
	consoles?: Consoles;
	/** What the four temperature and pressure readouts are. Default: displays. */
	readouts?: Readout | readonly [Readout, Readout, Readout, Readout];
	/** Start with every recipe on the drive in bay 1. Default true. */
	recipes?: boolean;
	/** Starting props, by device. */
	props?: Partial<Record<DeviceName, Record<string, number>>>;
	/** Devices left off their ports. */
	without?: readonly DeviceName[];
	/** More rack options: drives, switches, memory… */
	rack?: Partial<RackOptions>;
}

const gas = (Temperature: number, Pressure: number) => ({ Temperature, Pressure, TotalMoles: 100, Volume: 100 });

/** The rack, with every device on its port; the furnace is on, cold and at 1000 kPa. */
export function build(setup: RackSetup = {}): Promise<World> {
	const { chips = Object.keys(CHIPS).filter((c) => c !== "setup") as ChipName[], consoles = "vanilla", recipes = true } = setup;
	const parts = CONSOLE_PARTS[consoles];
	const readouts = typeof setup.readouts === "string" || setup.readouts === undefined ? Array(4).fill(setup.readouts ?? "display") : setup.readouts;
	const readout = (i: number) => (readouts[i] === "display" ? parts.display : readouts[i]);
	const prefabs: Record<DeviceName, [string, Record<string, number>]> = {
		furnace: ["StructureAdvancedFurnace", { Temperature: 300, Pressure: 1000, On: 1 }],
		releaseLever: [parts.cover, { Setting: 0 }],
		flushLever: [parts.lever, { Setting: 0 }],
		fuelPump: ["StructureVolumePump", {}],
		fuelPa: ["StructurePipeAnalysizer", gas(300, 6000)],
		coolantPump: ["StructureVolumePump", {}],
		coolantPa: ["StructurePipeAnalysizer", gas(300, 1000)],
		mixer: ["StructureGasMixer", {}],
		o2Pa: ["StructurePipeAnalysizer", gas(300, 1000)],
		h2Pa: ["StructurePipeAnalysizer", gas(300, 1000)],
		ingotDial: [parts.dial, { Setting: 0 }],
		amountDial: [parts.dial, { Setting: 1 }],
		confirm: [parts.button, { Setting: 0 }],
		amountLed: [parts.display, {}],
		statusLed: [parts.display, {}],
		statusLight: [parts.light, {}],
		pumpsLed: [parts.display, {}],
		ventLever: [parts.lever, { Setting: 0 }],
		ventOut: ["StructureActiveVent", {}],
		ventIn: ["StructureActiveVent", {}],
		sensor: ["StructureGasSensor", { Temperature: 295, Pressure: 101 }],
		furnaceK: [readout(0), {}],
		furnaceKpa: [readout(1), {}],
		boxK: [readout(2), {}],
		boxKpa: [readout(3), {}],
	};
	let builder = sim({ root: REPO_ROOT, debug: false });
	const ports: Record<number, string> = {};
	for (const [device, [prefab, props]] of Object.entries(prefabs) as [DeviceName, [string, Record<string, number>]][]) {
		// The prefab varies with the consoles chosen, so its props can't be typed per prefab here.
		builder = builder.device(device, prefab as never, { ...props, ...setup.props?.[device] } as never);
		if (!setup.without?.includes(device)) ports[PORTS[device]] = device;
	}
	const order = Object.keys(CHIPS) as ChipName[];
	const sockets = order.map((name) => (chips.includes(name) ? { key: name, file: CHIPS[name] } : undefined));
	return builder
		.add("rack", serverRack, {
			...setup.rack,
			ports: { ...ports, ...setup.rack?.ports },
			chips: sockets,
			memory: { ...(recipes ? recipeCells() : {}), ...setup.rack?.memory },
		})
		.build();
}

/** The rack's handle: its memory, drives and switches. */
export const rack = (world: World) => serverRack.handle(world, "rack");

/**
 * Sets a scratch cell, as another chip's `put` would. The handle's `setMemory` takes drive cells
 * only, so this goes to the rack's own eight cells.
 */
export function setScratch(world: World, address: number, value: number) {
	const device = rack(world).device.raw as unknown as { scratch: number[] };
	const first = rack(world).size + 40; // the scratch cells are status registers 40-47
	if (address < first || address >= first + 8) throw new Error(`${address} isn't a scratch cell`);
	device.scratch[address - first] = value;
}

/**
 * A lever thrown. Its position is `Setting`, which follows it on every lever part but the
 * FlipSwitch (audit B1). `Open` is left alone: on a FlipCoverSwitch it's the cover, so a script
 * reading that instead fails its tests.
 */
export function lever(world: World, device: DeviceName, on: boolean) {
	world.device(device).set("Setting", on ? 1 : 0);
}
