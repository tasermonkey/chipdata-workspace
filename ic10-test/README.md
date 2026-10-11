# @tasermonkey/ic10-test

Test harness for Stationeers IC10 scripts. It runs them on the
[@stationeers-ic/ic10](https://github.com/tasermonkey/ic10) emulator fork, inside Vitest, under the
game's execution rules.

This package is self-contained so it can move to its own repository later. Nothing in `src/` may
import from outside this directory, except `@stationeers-ic/ic10` and Node built-ins. Only `src/engine/`
touches the emulator's internals.

```ts
import { sim } from "@tasermonkey/ic10-test";

const world = await sim()
	.device("vent", "StructureActiveVent", { TemperatureOutput: 500 })
	.device("sensor", "StructureGasSensor", { Temperature: 300 })
	.housing("ic", { file: "ic10/vent.ic10", pins: { d0: "vent", d1: "sensor" } })
	.build();

world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 450)); // day comes
await world.runTicks(30);

expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
expect(world.chip("ic")).toHaveRegister("OutsideTemp", 450); // aliases work
expect(world.chip("ic")).toHaveNoErrors();
```

## Devices the emulator doesn't know

Mods' devices (the console mod's `ModularDevice…` parts, `StationBatteryNuclear`, mirrored
devices, …) are listed in `data/mods/prefabs.json`, from the Stationpedia export (see "Device
catalogue"). `sim()` builds them like any game device: each has exactly its own logic types, with
the game's Read/Write, so a script that writes a property the device doesn't have, or a read-only
one, halts as it would in game. The same goes for the few game prefabs the emulator has data for
but no device class (`Landingpad_DataConnectionPiece`).

```ts
.device("delta", "ModularDeviceGauge3x3", { Setting: 0.5 }, { name: "Power Delta" })
```

A prefab in neither the emulator nor `data/mods/` is a build error, unless it's marked `custom`:

```ts
.device("widget", "ModFutureWidget", { Setting: 1 }, { custom: true })
```

A custom device's `PrefabHash` is `HASH(prefab)`, so `lb`, `sb`, `lbn` and `sbn` find it by type and
name; `ld` / `sd` find it by reference ID, and it can go on a pin. It has **every** logic property,
readable and writable. `custom` on a known prefab, or on a housing, is a build error. Better than
`custom`: refresh `data/mods/` from a new export.

## Execution model

- **Ticks.** Each tick (0.5 s of game time by default), every chip in declaration order runs until it
  `yield`s, `sleep`s, halts, ends, or has run 128 lines (an automatic yield). Blank, comment and label
  lines count toward the 128, as in game; `countNonInstructionLines: false` changes that.
- **Sleep** parks a chip until game time reaches its wake time; nothing waits in real time.
  `sleep 0` acts as a `yield`.
- **Errors halt the chip**, as in game: strong and critical errors stop it and set the housing's
  `Error` to 1. A halt is state to assert on (`chip.halted`, `chip.halt`), not a failure, unless
  the world is built with `failOnHalt: true`.
- **Switching a housing off and on** restarts its chip. Housings start switched on (`On` = 1) unless
  built with `props: { On: 0 }`. At the start of each chip's turn the housing's `On` is read: while
  it's 0 the chip is skipped, and once it's 1 again the chip starts over from line 0, with any halt
  cleared and the housing's `Error` back at 0. Off and on again within one turn goes unnoticed, so a
  script restarting another chip has to `yield` in between. Registers and the stack are kept, unless
  `restartClearsState: true` (not yet confirmed in game). This applies to IC housings only
  (`StructureCircuitHousing`, `…Compact`, `StructureRocketCircuitHousing`). On other devices that
  take a chip, `On` is the device's own function (a hardsuit's is its A/C), so the chip keeps
  running. Several chips take their turns in
  declaration order within a tick, and each sees the others' writes as soon as they happen.
- **Scripted events** (`at`, `every`, `when`) run at the start of a tick, before any chip.
- Line numbers are **0-based indices**, like the game's `LineNumber` property.

## Run controls and budgets

| Call | Does |
|---|---|
| `step(n, chip?)` | Run *n* lines of a chip, ignoring ticks. |
| `runTicks(n)` / `runSeconds(s)` | Advance game time. |
| `runUntil(pred, { maxTicks })` | Run whole ticks until `pred(world)` holds. |
| `runUntilLine(labelOrIndex, { chip, maxTicks })` | Stop just before a chip runs that line (may be mid-tick). |
| `runToHalt({ maxTicks })`, `chip.runToHalt()` | Run until every chip (or that one) halts or ends. |

A run that goes over `maxTicks` (default 10,000) or `maxLinesPerRun` (default 1,000,000) fails with a
`SimBudgetError` whose message shows every chip's state and the last lines executed. `runUntil` also
fails at once if every chip has stopped and no events are due.

## Inspecting

- `world.device(key)`: `get`, `set` (read-only properties too), `add`, `props(...)`, `id`, `idHex`, `name`,
  `stackAt(i)` (the device's own memory, which `put` writes: a logic sorter's instructions, say), and
  `slot(i)`:
  - `put("ItemIronOre", { Quantity: 10 })` puts an item in, setting `Occupied`, `OccupantHash` and
    `Quantity` (default 1) as the game does; other slot values (`Mature`, …) go in the same object.
  - `get(prop)` reads as `ls` does (0 when empty), `set(prop, v)` changes the item, `clear()` empties
    it, `occupied` says whether there's an item.
- `world.chip(key)`: `reg("Stage" | "r15")`, `setReg`, `registers()`, `aliases()`, `stack()`, `stackAt(i)`,
  `sp`, `ra`, `line`, `findLabel`, `errors`, `halt`, `ended`, `sleeping`, `switchedOff`, `restarts`, `autoYields`,
  `autoYieldLog`, `pins`, `status`, `recentLines(n)`, `db`.
- `world.listDevices()`, `world.listChips()`, `world.deviceById(id)`.
- `world.network(id).byName(...)` / `.byType(...)`.
- `world.snapshot()` / `world.diff(before)`; `world.record("vent.On")` samples a value every tick.

## Matchers

Add `@tasermonkey/ic10-test/vitest` (in this repo, `./ic10-test/src/matchers/vitest-setup.ts`) to Vitest's `setupFiles`.

| Matcher | Subject | Passes when |
|---|---|---|
| `toHaveProps({ Mode: 1 })` | device, or chip (its housing) | Those properties have those values; others aren't checked. Asymmetric matchers such as `expect.closeTo` work. |
| `toHaveRegister(name, v)` | chip | `r15`, `sp`, `ra` or an alias has the value. |
| `toHaveRegisterCloseTo(name, v, digits = 2)` | chip | Within `10^-digits / 2`. |
| `toHaveStack([...])` / `toHaveStackAt(i, v)` | chip | The stack below `sp` / one entry. |
| `toBeAtLine(index | label)` | chip | It runs that line next, or halted on it. |
| `toHaveNoErrors({ severity })` | chip | Not halted, and no errors at or above `severity` (default `"warning"`, which includes reading a property a device doesn't have). |
| `toHaveHalted({ line, error, code })` | chip | Halted, optionally on that line with a matching message (string or RegExp) or code. |
| `toOnlyChange(paths, { since })` | world, or `world.diff(...)` | Nothing else changed. Paths can use aliases (`ic.Stage`) and `*`. A housing's `LineNumber` is ignored unless listed. |
| `toToggleAtMost(n)` | `world.record(...)` | The value changed at most `n` times. |
| `toNeverAutoYield()` | chip | Never ran out of lines in a tick. |
| `toAutoYieldAtMost(n, { perTicks })` | chip | At most `n` auto-yields, in total or in any window of `perTicks` ticks. |

A failure shows the chip's state and source line, its registers with aliases (values that are
reference IDs are labelled with their device), the stack, the devices on its pins and its housing,
and the last lines it ran; for auto-yields, where it was preempted and in which ticks. Each matcher
is a plain function underneath (`checkProps`, `checkRegister`, …), returning `{ pass, message }`,
and the reports are available as `chipReport`, `deviceReport` and `worldReport`.

## Device catalogue

`npm run catalog:build` (run automatically before `npm test` and `npm run typecheck`) writes
`generated/catalog.json`: every prefab's logic types with Read/Write, its slots and its modes (by
value), and a description of each logic type. It also writes `generated/prefab-props.ts`, which types
`sim()`: a misspelt prefab or property is a compile error, and hovering a property shows its
description, Read/Write and, for `Mode`, the mode names.

```ts
sim().device("vent", "StructureActiveVent", { Mdoe: 1 });   // error: 'Mdoe' does not exist
sim().housing("ac", { code, prefab: "StructureAirConditioner", props: { TemperatureInput: 300 } });
```

A prefab in a variable needs the `KnownPrefab` type (or `as const` on a list of names);
`PropsOf<"StructureActiveVent">` is one prefab's properties. A `custom` device takes any names.

- **Prefabs** come from the emulator's game data, plus mods' devices in `data/mods/prefabs.json`
  (console parts, `StationBatteryNuclear`, mirrored devices, …), which is committed.
- **Descriptions** come from a local Stationpedia export (below), then the installed game's
  `Language/english.xml`; the game is found through `STATIONEERS_DIR` or the default Steam path.
  Without either (e.g. in CI) there are none; everything else is the same. The build says which it
  used and lists logic types that have no description.
- `generated/` is gitignored, because the descriptions are the game's own text.

**Refreshing the mods' devices**, after a game update or a mod change. You don't need this to build or test.

1. Install [StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor)
   (a BepInEx plugin: `StationpediaExtractor.dll` into `BepInEx/plugins/`), start the game with
   your mods, load a save, and run `stationpedia_export` in the F3 console. It writes
   `<game>/Stationpedia/Enums.json` and `Stationpedia.json`.
2. `npm run catalog:import-stationpedia` (or `-- <folder>` if the export is elsewhere) rewrites
   `data/mods/prefabs.json` with every prefab that has logic but isn't in the emulator's data, and
   prints what was added, changed or removed. It also lists game prefabs whose logic types differ
   from the emulator's data; the catalogue keeps the emulator's, since that's what it enforces.
3. Commit `data/mods/prefabs.json`. Only names, hashes, Read/Write, slots and modes go in it; the
   export's descriptions stay local, and `catalog:build` reads them from the export folder.

```ts
import { loadCatalog, prefabInfo, canAccess } from "@tasermonkey/ic10-test";

const vent = prefabInfo("StructureActiveVent");   // { logic: { Mode: "rw", … }, modes: ["Outward", "Inward"], … }
canAccess(vent!, "PressureInternal", "r");
loadCatalog().logicTypes.On;                       // { text: "The current state of the device, 0 for off, 1 for on", source: "game" }
```

## Looking things up

`npx ic10-test` looks things up in the catalogue (building it first if it's missing):

```
npx ic10-test props StructureActiveVent    # logic types with R/W and descriptions, modes, slots
npx ic10-test props round button           # by words of the name or title; several matches are listed
npx ic10-test props 489382030              # by hash
npx ic10-test logic PressureInternal       # what it is, and every prefab that has it
npx ic10-test logic ratioozone             # logic types whose name contains it
```

## Checking scripts without running them

`checkBatchOps(source, loadCatalog())` checks a script's batch instructions (`lb`, `lbn`, `lbs`,
`lbns`, `sb`, `sbn`, `sbs`) against the catalogue: for a device type it can resolve (`HASH("…")`, a
hash number, or a define of either), the prefab must have the logic type, readable for a load and
writable for a store, or in a slot for the slot forms. It reports a `HASH()` of an unknown prefab
too. A type in a register, or a logic type given as a number, is skipped. It returns findings with
0-based lines; the workspace's `tests/scripts-batch-ops.test.ts` runs it over every script.

## Env files

`World.fromEnv(env, options)` builds a world from the emulator's env JSON: an object, JSON text, or a
path relative to `root`. Devices are keyed by their `name` when it's unique, otherwise by reference
ID in `$hex` form (`world.device("$300")`); `{ testKeysById: { $300: "vent" } }` names them yourself. Chips
keep their starting registers and stack, and take the same options as `sim()`.

## Debugging

`sim({ debug: gate })` (or `setDefaultDebugGate(gate)`) installs hooks the scheduler awaits before every
line, on halts, on automatic yields and after each tick. The VS Code debugger will attach through this.

Also exported: `createEnv` (a lower-level world from emulator env JSON), `readScript` / `findScripts`,
`parseId` / `formatId`, and `hash(name)`, the game's `HASH()`.

Runs as TypeScript source on Node 24+ (no build step yet). Its own tests run with `npm test` in this
directory, or `npm test -w ic10-test` from the workspace root; the root `npm test` runs them too.
