/**
 * Clearer messages for the emulator's property errors (plan §6, use 2). The emulator names a device
 * by its prefab hash and sometimes a logic type by its number: "Device -236516384 property 38 not
 * found". Each error keeps the device it came from, so the harness can say which device, by test
 * key, prefab and reference ID, and list what it does have.
 */
import { type Device, type Ic10Error, Logics } from "@stationeers-ic/ic10";
import { formatId } from "./ids.ts";

const NOT_FOUND = /^Device -?\d+ property (\S+) not found$/;
const NO_PERMISSION = /^Device -?\d+ has no permission to (read|write) (\S+)$/;

/** Logic type names past this many are summarised. */
const LIST_LIMIT = 16;

function logicName(token: string): string {
	if (!/^\d+$/.test(token)) return token;
	return (Logics as unknown as { getByValue(code: number): string | undefined }).getByValue(Number(token)) ?? token;
}

/**
 * The device's logic types from its game data (a mod's device is registered there too). Its props
 * can't list them: the emulator only iterates properties that have a value.
 */
function propertyNames(device: Device): { readable: string[]; writable: string[]; all: string[] } | undefined {
	const logics = device.rawData?.logics;
	if (!logics) return undefined; // a custom device, which has every logic type
	const names = (permission?: string) =>
		logics.filter((l) => !permission || l.permissions.includes(permission)).map((l) => l.name).sort();
	return { readable: names("Read"), writable: names("Write"), all: names() };
}

function list(names: string[]): string {
	if (names.length === 0) return "none";
	if (names.length <= LIST_LIMIT) return names.join(", ");
	return `${names.slice(0, LIST_LIMIT).join(", ")} and ${names.length - LIST_LIMIT} more`;
}

/**
 * The harness's message for a property error, or undefined for any other error. `keyOf` gives a
 * device's test-side key, if it has one.
 */
export function describePropertyError(error: Ic10Error, keyOf: (id: number) => string | undefined): string | undefined {
	const device = error.device;
	if (!device) return undefined;
	const prefab = device.prefabName?.value ?? `prefab hash ${device.hash}`;
	const key = keyOf(device.id);
	const who = key ? `"${key}" (${prefab} ${formatId(device.id)})` : `${prefab} ${formatId(device.id)}`;
	const names = propertyNames(device);

	const known = (label: string, which: keyof NonNullable<typeof names>) => (names ? `; ${label} ${list(names[which])}` : "");

	const notFound = NOT_FOUND.exec(error.message);
	if (notFound) {
		return `${who} has no logic type ${logicName(notFound[1]!)}${known("it has", "all")}`;
	}
	const noPermission = NO_PERMISSION.exec(error.message);
	if (noPermission) {
		const prop = logicName(noPermission[2]!);
		return noPermission[1] === "read"
			? `${who} can't read ${prop}: it's write-only${known("readable:", "readable")}`
			: `${who} can't write ${prop}: it's read-only${known("writable:", "writable")}`;
	}
	return undefined;
}
