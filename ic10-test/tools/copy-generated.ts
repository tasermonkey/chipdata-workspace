/**
 * Copies generated/catalog.json into dist/generated/ for the build: tsc compiles prefab-props.ts
 * there but leaves the JSON, which src/catalog/catalog.ts reads beside the compiled files.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
cpSync(join(root, "generated", "catalog.json"), join(root, "dist", "generated", "catalog.json"));
