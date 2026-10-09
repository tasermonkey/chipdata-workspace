import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EnvSchema, Housing } from "@stationeers-ic/ic10";
import { buildEngineFromEnv } from "../engine/build.ts";
import { formatId, parseId, type ReferenceId } from "../engine/ids.ts";
import { assembleWorld, type ChipDecl, type SimOptions } from "./sim.ts";
import type { DeviceEntry, World } from "./world.ts";

export interface EnvWorldOptions extends SimOptions {
	/**
	 * Test-side keys for devices, by reference ID, e.g. `{ $1488: "lathe" }`. Others are keyed by
	 * their `name` when it's unique, otherwise by reference ID in `$hex` form.
	 */
	testKeysById?: Record<ReferenceId, string>;
}

/** Build a world from emulator env JSON: an object, JSON text, or a path to a file. */
export async function worldFromEnv(source: EnvSchema | string, options: EnvWorldOptions = {}): Promise<World> {
	const root = options.root ?? process.cwd();
	const env: EnvSchema =
		typeof source !== "string"
			? source
			: JSON.parse(source.trimStart().startsWith("{") ? source : readFileSync(resolve(root, source), "utf8"));

	const keyOf = envKeys(env, options.testKeysById ?? {});
	const engine = buildEngineFromEnv(env, options.seed ?? 1, (id) => keyOf.get(id) ?? formatId(id));

	const networkTypes = new Map(env.networks.map((n) => [n.id, n.type]));
	const entries: DeviceEntry[] = env.devices.map((d) => {
		const ports = d.ports ?? [];
		const port = ports.find((p) => networkTypes.get(p.network) === "data") ?? ports[0];
		return {
			key: keyOf.get(d.id)!,
			device: engine.devices.get(d.id)!,
			prefab: d.PrefabName,
			network: port?.network ?? "",
		};
	});

	const chips: ChipDecl[] = [];
	for (const id of engine.chips.keys()) {
		const housing = engine.devices.get(id) as Housing;
		const pins: Record<string, string> = {};
		for (const [index, device] of housing.connectedDevices) pins[`d${index}`] = keyOf.get(device.id) ?? formatId(device.id);
		chips.push({ key: keyOf.get(id)!, id, source: "<env>", pins });
	}
	return assembleWorld(engine, entries, chips, options);
}

/** Keys for every device: given ones first, then unique names, then `$hex` IDs. */
function envKeys(env: EnvSchema, given: Record<ReferenceId, string>): Map<number, string> {
	const keys = new Map<number, string>();
	for (const [id, key] of Object.entries(given)) keys.set(parseId(id), key);

	const nameCount = new Map<string, number>();
	for (const d of env.devices) if (d.name) nameCount.set(d.name, (nameCount.get(d.name) ?? 0) + 1);
	const taken = new Set(keys.values());
	for (const d of env.devices) {
		if (keys.has(d.id)) continue;
		const key = d.name && nameCount.get(d.name) === 1 && !taken.has(d.name) ? d.name : formatId(d.id);
		if (taken.has(key)) throw new Error(`fromEnv: two devices would both be keyed "${key}"; name one with { testKeysById }`);
		keys.set(d.id, key);
		taken.add(key);
	}
	return keys;
}
