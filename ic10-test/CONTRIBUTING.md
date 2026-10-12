# Working on ic10-bench

Notes for changing the harness itself. To use it to test your own scripts, see the
[README](README.md).

## Layout rules

This package is self-contained so it can move to its own repository later. Nothing in `src/` may
import from outside this directory, except `@tasermonkey/ic10` (the emulator fork) and Node built-ins. Only
`src/engine/` touches the emulator's internals.

In a checkout it runs as TypeScript source on Node 24+, through the `"source"` export condition
(`--conditions=source` for Node, `resolve.conditions` for Vitest, `customConditions` for tsc), the
same way it uses the emulator fork. Its own tests run with `npm test` in this directory, or
`npm test -w ic10-test` from the workspace root; the root `npm test` runs them too. `npm run
typecheck` checks the package with its own `tsconfig.json`.

## Building and publishing

`npm run build` compiles `src/`, `bin/` and `generated/` into `dist/` (`tsconfig.build.json`:
declarations, and `.ts` imports rewritten to `.js`), and copies `generated/catalog.json` beside
them. Node won't strip types inside `node_modules`, so the published package runs from `dist/`;
each `exports` entry has `source` (the checkout), `types` and `default` (the build). `npm pack`
builds first (`prepack`); the tarball holds `dist/` alone. The build resolves `@tasermonkey/ic10`
without the source condition, so the emulator must be built (`npm run build:lib` in the fork) or
installed from npm.

To try the package as a user would: `npm pack`, then in an empty folder `npm i -D <the fork's
tarball> <this tarball> vitest`, add a `vitest.config.ts` with `defineIc10Config()`, and run a test.

## The project

Everything the harness reads or writes for a user's project is under the project's folder:
`IC10_BENCH_ROOT`, which `defineIc10Config` sets (`src/config.ts`), or the working directory
(`src/project.ts`). `ic10-bench --project <folder>` sets it for the CLI.

- `ic10-mods/<machine id>.json`: mods' devices, committed (`ic10-bench import-mods`).
- `.ic10-bench/`: git-ignored. `catalog.json` (`ic10-bench catalog`) and `machine.json`.
- `ic10-bench-env.d.ts`: git-ignored, written by `ic10-bench catalog`.

This package's own tests use the fixture project in `test/fixtures/project/`, with a few mods'
devices; `npm test` builds its catalogue first (`catalog:fixture`).

## Device catalogue

There are two:

- **Packaged**: `npm run catalog:build` (before `npm test`, `npm run typecheck` and `npm run
  build`) writes `generated/catalog.json`, every prefab in the emulator's game data with its logic
  types and Read/Write, its slots and its modes (by value), and `generated/prefab-props.ts`, the
  `GamePrefabProps` interface. No descriptions and no mods: it's published, and descriptions are
  the game's text. `generated/` is git-ignored.
- **The project's**: `ic10-bench catalog` (`src/cli/catalog.ts`) builds the same prefabs plus the
  project's mods, with descriptions from a local Stationpedia export, then the installed game's
  `Language/english.xml` (found through `STATIONEERS_DIR` or Steam). It writes
  `.ic10-bench/catalog.json` and `ic10-bench-env.d.ts`.

`loadCatalog()` returns the project's catalogue if it's been built, else the packaged one with the
project's mods added. `sim()` reads the mods from `ic10-mods/` directly, so a test can use a mod's
device before `ic10-bench catalog` has run.

**Types.** `src/prefabs.ts` declares an empty `ProjectPrefabs` interface, and `PrefabProps` is
`GamePrefabProps` while that's empty, else `ProjectPrefabs`. A project's `ic10-bench-env.d.ts`
fills `ProjectPrefabs` with every prefab, mods and descriptions included, by augmenting the module
`@tasermonkey/ic10-bench/prefabs` (the file has `export {}`, so it augments rather than declares).
It's the "register" pattern Vue and React Router use for app-specific types.

**Matchers' types** are in `src/matchers/types.ts`, as an augmentation of Vitest's `Matchers`. The
package's entry exports `Ic10Matchers` from that file, so any project that imports the package gets
them; the setup file only installs the matchers at run time.

### Mods' devices

`ic10-bench import-mods` (`src/cli/import-mods.ts`) rewrites this machine's file,
`ic10-mods/<machine id>.json`, from the Stationpedia export: every prefab that has logic but isn't
in the emulator's data. It prints what was added, changed or removed, and lists game prefabs whose
logic types differ from the emulator's data; the catalogue keeps the emulator's, since that's what
it enforces. Only names, hashes, Read/Write, slots and modes go in the file. The README's "Using
modded devices" gives the steps, export included.

The machine id is a random 8-hex string made on first use and kept in `.ic10-bench/machine.json`.
Each machine's file is its own, so two machines never edit the same file. Each file also lists the
workshop mods (`installedMods`: id, name, version) installed when it was made, so a difference
between two files can be traced to a mod version.

The loader reads every `ic10-mods/*.json`. The local machine's file wins; prefabs only another file
has are merged in. Where another file gives a prefab different logic, it warns and keeps the local
one.

```ts
import { loadCatalog, prefabInfo, canAccess } from "@tasermonkey/ic10-bench";

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

When `IC10_DEBUG` is set (`port` or `host:port`), the Vitest setup file (`@tasermonkey/ic10-bench/vitest`)
connects to the debugger there before the tests run and makes its agent the default gate
(`attachDebugger`), so tests need no changes. Each test is held back until the debugger has set its
breakpoints. If the debugger goes away, the test runs on without stopping. The debugger runs one test at a
time with Vitest's `file:line` filter and `--testTimeout=0`, so a paused test doesn't time out.

`DebugAgent` is the debugger's side in the test process: a gate (`agent.gate`) that talks to the VS Code
adapter over a `Transport`, using the protocol in `src/debug/protocol.ts` (exported as
`@tasermonkey/ic10-bench/debug-protocol`). It decides in the test process where to stop: breakpoints by file
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

`@tasermonkey/ic10-bench/run-scenario` runs a scenario under plain Node, which is how the debugger
launches one:

```
node node_modules/@tasermonkey/ic10-bench/dist/src/debug/run-scenario.js <scenario> [--program <file.ic10>] [--chip <key>]
```

From a checkout, the debugger runs `src/debug/run-scenario.ts` with `--conditions=source` instead
(`findHarnessFile` in the extension's `adapter.ts` reads the package's `exports` to choose).

With `IC10_DEBUG` set it attaches first. It runs ticks as fast as it can until `world.idle()`, then
says so and exits, or exits when the debugger goes away.

## Lower-level exports

`createEnv` (a lower-level world from emulator env JSON), `parseId` / `formatId`, and the plain
functions under each matcher (`checkProps`, `checkRegister`, …, returning `{ pass, message }`) with
the reports `chipReport`, `deviceReport` and `worldReport`.
