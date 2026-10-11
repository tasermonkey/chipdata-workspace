import {
	type BiMap,
	DEVICES,
	type Device,
	type DeviceType,
	Devices,
	DevicesByPrefabName,
	HashString,
	ItemEntity,
	type Slot,
	Structure,
} from "@stationeers-ic/ic10";
import type { CatalogPrefab } from "../catalog/catalog.ts";

/** Whether the emulator has a device class for this prefab, so its env format can build one. */
export function isCatalogued(prefab: string): boolean {
	return Object.hasOwn(DevicesByPrefabName, prefab);
}

let prefabsWithData: Set<string> | undefined;

/**
 * Whether the emulator's game data describes this prefab. A few prefabs have data but no device
 * class (a landing pad's data connection piece, say); they're built as a {@link CustomDevice},
 * which then gets exactly their logic types from the data.
 */
export function hasDeviceData(prefab: string): boolean {
	prefabsWithData ??= new Set(Object.values(DEVICES as Record<number, DeviceType>).map((d) => d.PrefabName ?? ""));
	return prefabsWithData.has(prefab);
}

/**
 * Add a mod's device to the emulator's device table, so a device built with its hash gets exactly
 * its logic types (with Read/Write), slots and modes, as a game prefab would. Global, like
 * {@link CustomDevice}'s hash registration, but only ever adds a prefab the emulator doesn't have.
 */
export function registerModPrefab(prefab: CatalogPrefab): void {
	const table = DEVICES as Record<number, DeviceType>;
	if (table[prefab.hash]) return;
	const permissions = (access: string) => [...(access.includes("r") ? ["Read"] : []), ...(access.includes("w") ? ["Write"] : [])];
	table[prefab.hash] = {
		id: prefab.hash,
		Title: prefab.title,
		Key: prefab.prefab,
		PrefabName: prefab.prefab,
		PrefabHash: prefab.hash,
		hasChip: false,
		deviceConnectCount: 0,
		image: null,
		mods: prefab.modes as DeviceType["mods"],
		hasMemory: false,
		tags: ["HasLogic", ...(prefab.slots.length ? ["HasSlot"] : []), ...(prefab.modes.length ? ["HasMode"] : [])] as DeviceType["tags"],
		logics: Object.entries(prefab.logic).map(([name, access]) => ({ name, permissions: permissions(access) })),
		connections: [],
		slots: prefab.slots.map((s) => ({ SlotName: s.name, SlotType: s.type, SlotIndex: s.index, logic: s.logic })),
		memoryAccess: null,
		memorySize: null,
		logicInstructions: [],
	};
}

/**
 * A device the emulator's catalogue doesn't have. Its PrefabHash is HASH(prefab), so batch
 * instructions find it. A mod's device registered with {@link registerModPrefab} has exactly its
 * own logic types; any other has every logic property, readable and writable.
 */
export class CustomDevice extends Structure {
	constructor(id: number, prefab: string) {
		const prefabName = new HashString(prefab);
		// lb, sb and the rest reject a hash missing from this table. Registering it is global, but
		// only adds a prefab the game has and the emulator doesn't.
		(Devices as unknown as BiMap<number, string>).set(prefabName.hash, prefab);
		super({ id, hash: prefabName.hash, name: prefab });
		Object.defineProperty(this, "prefabName", { value: prefabName });
		this.errors.reset(); // the emulator's "unknown device" warnings
	}
}

/** Whether the device has a logic property of this name (readable or writable). */
export function hasProp(device: Device, prop: string): boolean {
	const props = device.hasProps ? device.props : undefined;
	return !!props && (props.canLoad(prop) || props.canStore(prop));
}

function requireProp(device: Device, prop: string): void {
	if (!hasProp(device, prop)) {
		throw new Error(`${device.prefabName ?? "device"} (${device.id}) has no logic property "${prop}"`);
	}
}

/** Read a property as the world sees it (no permission checks); unset properties read 0. */
export function readProp(device: Device, prop: string): number {
	requireProp(device, prop);
	return device.props?.forceRead(prop) ?? 0;
}

/** Write a property, bypassing read-only permissions, as the game does when it updates readings. */
export function writeProp(device: Device, prop: string, value: number): void {
	requireProp(device, prop);
	device.props?.forceWrite(prop, value);
}

/** Every property that has a value, by name. */
export function listProps(device: Device): Record<string, number> {
	const out: Record<string, number> = {};
	if (!device.hasProps) return out;
	for (const { logicName, value } of device.props!) out[logicName] = value;
	return out;
}

/** Write a property if the device has it, otherwise do nothing. */
export function writePropIfPresent(device: Device, prop: string, value: number): void {
	if (hasProp(device, prop)) device.props?.forceWrite(prop, value);
}

function slotOf(device: Device, index: number): Slot {
	const slot = device.hasSlots ? device.slots?.getSlot(index) : undefined;
	if (!slot) throw new Error(`${device.prefabName ?? "device"} (${device.id}) has no slot ${index}`);
	return slot;
}

/** Whether the slot holds an item. */
export function slotOccupied(device: Device, index: number): boolean {
	return slotOf(device, index).hasItem();
}

/**
 * Put an item in a slot, replacing what's there. `Occupied`, `OccupantHash` and `Quantity` (default 1)
 * are set as the game sets them; `props` sets those and any other slot logic values.
 */
export function putItem(device: Device, index: number, item: string, props: Record<string, number> = {}): void {
	const entity = new ItemEntity(new HashString(item).hash, props.Quantity ?? 1);
	entity.setProp("Occupied", 1);
	entity.setProp("OccupantHash", entity.hash);
	for (const [prop, value] of Object.entries(props)) writeItemProp(entity, prop, value);
	slotOf(device, index).putItem(entity, true);
}

/** Empty a slot. */
export function clearSlot(device: Device, index: number): void {
	slotOf(device, index).removeItem();
}

/** A slot logic value as `ls` reads it: 0 for an empty slot. */
export function readSlot(device: Device, index: number, prop: string): number {
	return slotOf(device, index).getProp(prop);
}

/** Set a slot logic value on the item in it. */
export function writeSlot(device: Device, index: number, prop: string, value: number): void {
	const item = slotOf(device, index).getItem();
	if (!item) throw new Error(`${device.prefabName ?? "device"} (${device.id}) slot ${index} is empty`);
	writeItemProp(item, prop, value);
}

function writeItemProp(item: ItemEntity, prop: string, value: number): void {
	if (prop === "Quantity") item.count = value;
	else item.setProp(prop, value);
}

/** The game's `HASH("name")`: a CRC-32 as a signed 32-bit number. */
export function hash(name: string): number {
	return new HashString(name).hash;
}
