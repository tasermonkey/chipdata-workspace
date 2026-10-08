import type { Device } from "@stationeers-ic/ic10";

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
