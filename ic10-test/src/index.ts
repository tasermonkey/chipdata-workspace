export {
	type Access,
	type Catalog,
	type CatalogDescription,
	type CatalogPrefab,
	type CatalogSlot,
	canAccess,
	loadCatalog,
	prefabInfo,
} from "./catalog/catalog.ts";
export { type BatchOpCatalog, type BatchOpFinding, type BatchOpProblem, checkBatchOps } from "./lint/batch-ops.ts";
export * from "./matchers/checks.ts";
export { chipReport, deviceReport, worldReport } from "./matchers/report.ts";
export { type DebugGate, type DebugLineInfo, setDefaultDebugGate } from "./debug/gate.ts";
export type { StepOutcome } from "./engine/chip.ts";
export { hash } from "./engine/device.ts";
export { createEnv, type Env } from "./engine/env.ts";
export { formatId, parseId, type ReferenceId } from "./engine/ids.ts";
export { SimBudgetError, SimHaltError, SimRunError } from "./scheduler/errors.ts";
export type { Halt } from "./scheduler/scheduler.ts";
export { findScripts, readScript } from "./scripts.ts";
export type { Cancel, Interval, When, WorldEvent } from "./world/events.ts";
export {
	type DeviceOptions,
	type HousingOptions,
	type KnownPrefab,
	type Pin,
	type PropsOf,
	SimBuilder,
	type SimOptions,
	sim,
} from "./world/sim.ts";
export type { Change, Recording, Snapshot } from "./world/snapshot.ts";
export type { EnvWorldOptions } from "./world/from-env.ts";
export { ChipHandle, DeviceHandle, NetworkHandle, type RunBudget, SlotHandle, World } from "./world/world.ts";
