/**
 * Builds the packaged device catalogue into generated/ (plan §6): catalog.json, and
 * prefab-props.ts, the `GamePrefabProps` that `sim().device()` is checked against.
 *
 *   npm run catalog:build      (node --conditions=source tools/catalog-build.ts)
 *
 * The emulator's prefabs only, and no descriptions: the package is published, and descriptions are
 * the game's text. A project adds both with `ic10-bench catalog` (src/cli/catalog.ts).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEVICES } from "@tasermonkey/ic10";
import { buildCatalog } from "../src/catalog/build.ts";
import { GENERATED_DIR, PACKAGED_CATALOG_PATH } from "../src/catalog/catalog.ts";
import { prefabPropsSource } from "../src/catalog/types.ts";

const { catalog } = buildCatalog({ devices: Object.values(DEVICES) });

await mkdir(GENERATED_DIR, { recursive: true });
await writeFile(PACKAGED_CATALOG_PATH, `${JSON.stringify(catalog)}\n`);
await writeFile(join(GENERATED_DIR, "prefab-props.ts"), prefabPropsSource(catalog));

console.log(`catalog: ${Object.keys(catalog.prefabs).length} prefabs, ${Object.keys(catalog.logicTypes).length} logic types (packaged, no descriptions)`);
