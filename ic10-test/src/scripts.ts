import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Read an IC10 script (absolute, or relative to the working directory), normalising CRLF. */
export function readScript(path: string): string {
	return readFileSync(resolve(path), "utf8").replace(/\r\n/g, "\n");
}

/** Every `.ic10` file under `dir`, recursively, as sorted absolute paths. */
export function findScripts(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(resolve(dir), entry.name);
		if (entry.isDirectory()) out.push(...findScripts(full));
		else if (entry.name.endsWith(".ic10")) out.push(full);
	}
	return out.sort();
}
