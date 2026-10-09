import { type BiMap, type Device, Devices, DevicesByPrefabName, HashString, Structure } from "@stationeers-ic/ic10";

/** Whether the emulator's device catalogue has this prefab. */
export function isCatalogued(prefab: string): boolean {
	return Object.hasOwn(DevicesByPrefabName, prefab);
}

/**
 * A device the emulator's catalogue doesn't have, such as a console-mod display. Its PrefabHash is
 * HASH(prefab), so batch instructions find it, and it has every logic property, readable and writable.
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
