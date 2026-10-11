/**
 * The catalogue lookups behind the `ic10-test` command (plan §6, use 4). Pure functions from the
 * catalogue to text, so they can be tested without a terminal.
 */
import type { Access, Catalog, CatalogPrefab } from "../catalog/catalog.ts";

const ACCESS: Record<Access, string> = { r: "R", w: "W", rw: "RW" };

/** A description on one line (Color's lists its colours on separate lines). */
const oneLine = (text: string | undefined) => (text ?? "").replace(/\s*\n\s*/g, " ").trim();

/**
 * The prefab named `query`, the one whose hash it is, or else those whose name or title contains
 * every word of it (case-insensitive): "round button" finds ModularDeviceRoundButton.
 */
export function findPrefabs(catalog: Catalog, query: string): CatalogPrefab[] {
	const exact = catalog.prefabs[query];
	if (exact) return [exact];
	const all = Object.values(catalog.prefabs);
	if (/^-?\d+$/.test(query.trim())) return all.filter((p) => p.hash === Number(query));
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return all
		.filter((p) => words.every((w) => p.prefab.toLowerCase().includes(w) || p.title.toLowerCase().includes(w)))
		.sort((a, b) => a.prefab.localeCompare(b.prefab));
}

function table(rows: string[][]): string[] {
	const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
	return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd());
}

/** One prefab: title, hash, source, then its logic types, modes and slots. */
export function describePrefab(catalog: Catalog, prefab: CatalogPrefab): string {
	const from = prefab.source === "mod" ? "a mod's device (data/mods/)" : "game";
	const lines = [`${prefab.prefab}  ${prefab.title}`, `hash ${prefab.hash}, ${from}`, ""];
	const logic = Object.entries(prefab.logic).sort(([a], [b]) => a.localeCompare(b));
	lines.push(...table([["Logic type", "R/W", "Description"], ...logic.map(([name, a]) => [name, ACCESS[a], oneLine(catalog.logicTypes[name]?.text)])]));
	if (prefab.modes.length) {
		lines.push("", `Modes: ${prefab.modes.map((m, i) => (m ? `${i} ${m}` : "")).filter(Boolean).join(", ")}`);
	}
	if (prefab.slots.length) {
		lines.push("", "Slots:");
		for (const slot of prefab.slots) {
			const name = slot.name ? `${slot.name} (${slot.type})` : slot.type;
			lines.push(`  ${slot.index}  ${name}: ${slot.logic.join(", ") || "no logic"}`);
		}
	}
	if (catalog.sources.descriptions.startsWith("none")) lines.push("", "(No descriptions: the catalogue was built without the game or a Stationpedia export.)");
	return lines.join("\n");
}

/** One logic type: its description and every prefab that has it, with R/W. */
export function describeLogic(catalog: Catalog, name: string): string | undefined {
	const prefabs = Object.values(catalog.prefabs)
		.filter((p) => p.logic[name])
		.sort((a, b) => a.prefab.localeCompare(b.prefab));
	if (!prefabs.length && !catalog.logicTypes[name]) return undefined;
	const lines = [name, catalog.logicTypes[name]?.text ?? "(no description)", "", `${prefabs.length} ${prefabs.length === 1 ? "prefab" : "prefabs"}:`];
	lines.push(...table(prefabs.map((p) => [`  ${p.prefab}`, ACCESS[p.logic[name]!], p.title])));
	return lines.join("\n");
}

/** Logic type names containing `query` (case-insensitive). */
export function findLogicTypes(catalog: Catalog, query: string): string[] {
	const names = new Set([...Object.keys(catalog.logicTypes), ...Object.values(catalog.prefabs).flatMap((p) => Object.keys(p.logic))]);
	const q = query.toLowerCase();
	return [...names].filter((n) => n.toLowerCase().includes(q)).sort();
}

/** A list of prefabs, for when a query matched several. */
export function listPrefabs(prefabs: CatalogPrefab[]): string {
	return table(prefabs.map((p) => [p.prefab, p.title, p.source === "mod" ? "(mod)" : ""])).join("\n");
}
