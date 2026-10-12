# Working on ic10-test

Notes for changing the harness itself. To use it to test your own scripts, see the
[README](README.md).

## Layout rules

This package is self-contained so it can move to its own repository later. Nothing in `src/` may
import from outside this directory, except `@tasermonkey/ic10` (the emulator fork) and Node built-ins. Only
`src/engine/` touches the emulator's internals.

It runs as TypeScript source on Node 24+ (no build step yet). Its own tests run with `npm test` in
this directory, or `npm test -w ic10-test` from the workspace root; the root `npm test` runs them too.

## Device catalogue

`npm run catalog:build` (run automatically before `npm test` and `npm run typecheck`) writes
`generated/catalog.json`: every prefab's logic types with Read/Write, its slots and its modes (by
value), and a description of each logic type. It also writes `generated/prefab-props.ts`, which types
`sim()`.

- **Prefabs** come from the emulator's game data, plus mods' devices in `data/mods/*.json`
  (console parts, `StationBatteryNuclear`, mirror-image layouts such as
  `StructureAirConditionerMirrored`, …), which are committed: one file per machine's export.
- **Descriptions** come from a local Stationpedia export (below), then the installed game's
  `Language/english.xml`; the game is found through `STATIONEERS_DIR` or the default Steam path.
  Without either (e.g. in CI) there are none; everything else is the same. The build says which it
  used and lists logic types that have no description.
- `generated/` is gitignored, because the descriptions are the game's own text.

### Refreshing the mods' devices

After a game update or a mod change. You don't need this to build or test.

1. Install [StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor)
   (a BepInEx plugin: `StationpediaExtractor.dll` into `BepInEx/plugins/`), start the game with
   your mods, load a save, and run `stationpedia_export` in the F3 console. It writes
   `<game>/Stationpedia/Enums.json` and `Stationpedia.json`.
2. `npm run catalog:import-stationpedia` (or `-- <folder>` if the export is elsewhere) rewrites
   this machine's file, `data/mods/<machine id>.json`, with every prefab that has logic but isn't
   in the emulator's data, and prints what was added, changed or removed. It also lists game
   prefabs whose logic types differ from the emulator's data; the catalogue keeps the emulator's,
   since that's what it enforces.
3. Commit that file. Only names, hashes, Read/Write, slots and modes go in it; the export's
   descriptions stay local, and `catalog:build` reads them from the export folder.

The machine id is a random 8-hex string made on first use and kept in `.local/machine.json`
(git-ignored). Each machine's file is its own, so two machines never edit the same file. Each file
also lists the workshop mods (`installedMods`: id, name, version) installed when it was made, so a
difference between two files can be traced to a mod version.

The loader reads every `data/mods/*.json`. The local machine's file wins; prefabs only another file
has are merged in. Where another file gives a prefab different logic, the build warns and keeps the
local one.

```ts
import { loadCatalog, prefabInfo, canAccess } from "@tasermonkey/ic10-test";

const vent = prefabInfo("StructureActiveVent");   // { logic: { Mode: "rw", … }, modes: ["Outward", "Inward"], … }
canAccess(vent!, "PressureInternal", "r");
loadCatalog().logicTypes.On;                       // { text: "The current state of the device, 0 for off, 1 for on", source: "game" }
```

## Where the game behaviour comes from

The Logic Mirror follows the game's code (plan §5.4). The gas core (`src/atmos/`) takes its
constants and each gas's specific heat from the game's `Assembly-CSharp.dll` (`R` 8.3144, a pipe
segment 10 L, a grid cell 8000 L). Each device model follows the game's code where it's in the DLL
(`ActiveVent`, `RoboticArmDockHydroponics`, …); per-prefab figures (a device's `pressurePerTick`, its
efficiency curves) live in the game's asset files, so those are guesses a test can tune. The model
docs in the README say which numbers are guesses.

## How the debugger attaches

`sim({ debug: gate })` (or `setDefaultDebugGate(gate)`) installs hooks the scheduler awaits before and
after every line, on halts, on automatic yields, after each tick and after each scripted event. The
VS Code debugger attaches through this.

When `IC10_DEBUG` is set (`port` or `host:port`), the Vitest setup file (`@tasermonkey/ic10-test/vitest`)
connects to the debugger there before the tests run and makes its agent the default gate
(`attachDebugger`), so tests need no changes. Each test is held back until the debugger has set its
breakpoints. If the debugger goes away, the test runs on without stopping. The debugger runs one test at a
time with Vitest's `file:line` filter and `--testTimeout=0`, so a paused test doesn't time out.

`DebugAgent` is the debugger's side in the test process: a gate (`agent.gate`) that talks to the VS Code
adapter over a `Transport`, using the protocol in `src/debug/protocol.ts` (exported as
`@tasermonkey/ic10-test/debug-protocol`). It decides in the test process where to stop: breakpoints by file
and line (with conditions and log messages), Step Over (a `jal` or branch-and-link call as one step), Step
Into, Step Out (to after the `j ra`), Pause, halts and, if asked, automatic yields. It keeps each chip's
call stack, as VS Code's Call Stack shows it: a taken `jal` or branch-and-link adds a frame (named by the
label it jumped to and the line it returns to), and the chip arriving back at that line, right after a
`j ra` or with `sp` back where it was, removes it. The stack is the call stack, as in assembly (`push ra`
… `pop ra`), so this follows nested and recursive calls. Step Over stops once the chip is back at the depth
it started at, and Step Out once it's a level up. Steps and Pause stop
only on instructions; blank, comment and label lines run past. `evaluate(chip, "vent.On")` gives a value as
conditions and hovers see it: numbers, registers, aliases, stack entries (`stack[3]`), defines, labels,
`d0.On`, `db.Setting`, or any world path. The tick commands (Step Tick, Run N Ticks, Run Until Event) use
the tick and event hooks. Data breakpoints watch such expressions: after each line the agent compares
them, so a stop names the line that changed one; before each line, after each event and at each tick's
end, it catches changes made outside the chips (an event, a model, a pipe reading, the test).

While stopped, the agent shows a chip's scopes: Registers (with aliases; values that are reference IDs
labelled with their device), Stack (below `sp`, the top marked, and entries above it that hold something),
Devices (by pin, then `db`, then the rest of the network: ID, prefab, name, network, properties and slots; a
Logic Mirror shows its target), Atmospheres, World (tick, time, lines this tick, auto-yields, sleep, events
to come, models) and Defines. Registers, stack entries, device properties and slot values can be edited; a
new value is an expression on the chip (`Max`, `$1488`). Readings from a pipe or room can't. A hover on a
logic type's name shows its catalogue description.

### Running a scenario

`@tasermonkey/ic10-test/run-scenario` runs a scenario under plain Node, which is how the debugger
launches one:

```
node --conditions=source node_modules/@tasermonkey/ic10-test/src/debug/run-scenario.ts <scenario> [--program <file.ic10>] [--chip <key>]
```

With `IC10_DEBUG` set it attaches first. It runs ticks as fast as it can until `world.idle()`, then
says so and exits, or exits when the debugger goes away.

## Lower-level exports

`createEnv` (a lower-level world from emulator env JSON), `parseId` / `formatId`, and the plain
functions under each matcher (`checkProps`, `checkRegister`, …, returning `{ pass, message }`) with
the reports `chipReport`, `deviceReport` and `worldReport`.
