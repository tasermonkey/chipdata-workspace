/**
 * The prefabs `sim()` knows, as types. The package ships `GamePrefabProps`, the emulator's prefabs.
 * `ic10-bench catalog` writes the project's ic10-bench-env.d.ts, which fills in `ProjectPrefabs`
 * with every prefab, the project's mods included; once it's filled in, it's used instead.
 */
import type { GamePrefabProps } from "../generated/prefab-props.ts";

export type { GamePrefabProps };

/** Filled in by a project's ic10-bench-env.d.ts (`declare module "@tasermonkey/ic10-bench/prefabs"`). */
export interface ProjectPrefabs {}

/** Each known prefab's logic properties: the project's, or the emulator's alone without ic10-bench-env.d.ts. */
export type PrefabProps = [keyof ProjectPrefabs] extends [never] ? GamePrefabProps : ProjectPrefabs;
