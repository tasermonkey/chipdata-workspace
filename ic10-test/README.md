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

Mods' devices (the console mod's `ModularDevice…` parts, `StationBatteryNuclear`, mirror-image
layouts such as `StructureAirConditionerMirrored`, …) are listed in `data/mods/prefabs.json`, from the Stationpedia export (see "Device
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

When a script touches a property a device doesn't have, or writes a read-only one, the error names
the device and says what it does have, in halt messages, `toHaveNoErrors` and `toHaveHalted`:

```
"switch" (ModularDeviceFlipCoverSwitch $AE87A) has no logic type Color; it has NameHash, On, Open, PrefabHash, ReferenceId, Setting
"battery" (StationBatteryNuclear $1001) can't write Ratio: it's read-only; writable: Lock, On
```

(The emulator's own message was "Device -236516384 property 38 not found".) As in game, a
bad write or a bad read halts the chip.

## Logic Mirror

A Logic Mirror (`StructureLogicMirror`) on one data network stands in for a target device on
another. Declare it with `.mirror`:

```ts
sim()
	.network("base")
	.network("outside")
	.device("sensor", "StructureGasSensor", { RatioNitrogen: 0.7 }, { network: "outside" })
	.mirror("mirror", { target: "sensor", network: "base" }) // powered: true by default
	.housing("ic", { code: "l r0 d0 RatioNitrogen\nyield", network: "base", pins: { d0: "mirror" } })
```

It follows the game's code (plan §5.4):
- `l`/`s` on its pin, and `ld`/`sd` with the mirror's own ID, read and write the target.
  `PrefabHash` and `ReferenceId` read through it are the target's.
- Unpowered (`world.mirror("mirror").setPowered(false)`), reads are 0 and writes are dropped.
- With no target, `ls`/`ss` through it, or a logic type the target lacks, the chip halts. The
  message names both: `"mirror" (StructureLogicMirror $1003) → "sensor" (StructureGasSensor $1001)
  has no logic type Setting; …`.
- Batch instructions see a Logic Mirror, not the target, and the target's own ID isn't on the
  mirror's network.

`world.mirror(key)` has `target`, `setTarget(key | undefined)`, `powered` and `setPowered`. A mirror
has no logic values of its own, so `get`/`set` on it throw; use the target's handle.

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
  `setStackAt(i, v)`, `stackLength`, `sp`, `ra`, `isInstruction(i)`, `line`, `findLabel`, `defines()` (the script's defines, aliases and labels so
  far), `errors`, `halt`, `ended`, `sleeping`, `sleepUntil`, `linesThisTick`, `switchedOff`, `restarts`,
  `autoYields`, `autoYieldLog`, `pins`, `status`, `recentLines(n)`, `db`, `source` (the file as given, or
  `<code>`) and `path` (the file's absolute path).
- `world.listEvents()`: scripted events still to come, with their next tick; `world.listModels()`: which
  device (or `world`) each model is for. `at`, `every` and `when` take `{ label }` to name an event.
- `world.mirror(key)`: a Logic Mirror's `target`, `setTarget`, `powered`, `setPowered` (see "Logic Mirror").
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
| `toHaveNoErrors({ severity })` | chip | Not halted, and no errors at or above `severity` (default `"warning"`, such as an alias that hides a built-in constant). |
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
  (console parts, `StationBatteryNuclear`, mirror-image layouts such as
  `StructureAirConditionerMirrored`, …), which is committed.
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

## Atmospheres

The gas core (`src/atmos/`) models gas plausibly rather than exactly: an ideal gas, mixed
perfectly, with no phase changes. Its constants and each gas's specific heat come from the game's
`Assembly-CSharp.dll` (`R` 8.3144, a pipe segment 10 L, a grid cell 8000 L). A gas's name is also
its logic type suffix (`Ratio${name}`).

```ts
const waste = new Mixture({ volume: 20 * PIPE_VOLUME, temperature: 400, gases: { CarbonDioxide: 30 } });
const air = Mixture.fromPressure({ volume: 8000, temperature: 293, pressure: 101.3, ratios: { Nitrogen: 7, Oxygen: 3 } });
const outside = new Reservoir({ temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } });

waste.pressure;                  // kPa, from P = nRT/V
waste.merge(outside.take(2));    // 2 mol of outside air; temperatures mix by heat capacity
exchangeHeat(waste, air, 0.1);   // 10% of the way to a shared temperature, energy conserved
```

- `Mixture` is a pipe network or sealed room: `moles`, `ratio`, `pressure`, `temperature`,
  `heatCapacity`, `add`, `take`, `takeGas`, `merge`, `addHeat`, `setTemperature`.
- `Reservoir` is outside air too big to change: gas taken comes out at its composition, gas and
  heat put in vanish, and `set({ temperature, pressure, ratios })` changes the weather.
- Liquids count toward moles and ratios, not pressure. Gases don't condense or boil yet (they do
  in game); that's planned for later.

### Pipes and rooms in a world

```ts
const world = await sim()
  .pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 150, pressure: 50, ratios: { CarbonDioxide: 1 } })
  .room("outside", { temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } })
  .device("pa",   "StructurePipeAnalysizer", {}, { pipe: "coolant" })
  .device("vent", "StructureActiveVent",     {}, { ports: { output: "coolant" }, room: "outside" })
  .device("out",  "StructureGasSensor",      {}, { room: "outside" })
  .build();
```

- `.pipe(key, …)` takes `gases` (moles) or `pressure` and `ratios`, and needs a `volume`.
  `.room(key, …)` with a `volume` is a sealed room; without one it's outside air (a `Reservoir`).
  Keys are shared with devices, so each must be unique.
- A device attaches with `{ pipe }` (the pipe it sits on: a pipe analyzer), `{ room }` (a gas
  sensor's room, or where a vent blows) and `{ ports: { input, input2, output, output2 } }`. Its
  readings come from them: `Pressure`, `Temperature`, `TotalMoles` and `Ratio<Gas>`, with the
  port's suffix (`PressureOutput`, `RatioNitrogenInput`), plus `Volume` on a pipe. A device's own
  readings come from its `pipe`, or else its `room`. A room's `TotalMoles` is per grid cell, as a
  gas sensor reads the cell it's in. A vent's one pipe is its `output`; an attachment that gives a
  device no readings is an error that says which ports it has. A device with no pipe readings at
  all (a volume pump, a regulator) takes pipes on any port, for its model.
- Those readings can't be set on the device, in the builder or with `set`: change the gas instead.
  `Combustion` and `VolumeOfLiquid` aren't modelled and stay settable. Devices with nothing attached
  work as before.
- Readings update at the start of every tick, after scripted events, so chips see that tick's
  gas. After changing a pipe between ticks, `world.refreshReadings()` shows it on devices at once.
- `world.pipe(key)` and `world.room(key)` return the atmosphere; a device handle has `.pipe`,
  `.room`, `.port("output")` and `.readings`. Paths such as `coolant.Temperature`,
  `coolant.RatioNitrogen` or `coolant.Nitrogen` (moles) work in `value`, `record` and snapshots,
  and failure reports list every pipe and room.

### Models: how devices behave

```ts
world.model("vent", activeVent());                                // a library model
world.model(heatExchange("coolant", "waste", { fraction: 0.1 })); // world-wide: a radiator
world.model("lamp", (lamp, dt, w) => { /* your own */ });
```

A model runs at the start of every tick, after scripted events and before readings refresh and
chips run, so a setting a script writes in one tick acts in the next. `world.model(key, fn)` gets
the device handle, the tick's length in seconds and the world; `world.model(fn)` gets `dt` and the
world. Both return a function that removes the model. An error in a model fails the run, naming it.
While there are models, `runUntil` doesn't give up when every chip has stopped.

The library (plausible, not exact). Each follows the game's code where it's in `Assembly-CSharp.dll`;
per-prefab figures (a device's `pressurePerTick`, its efficiency curves) live in the game's asset
files, so those are guesses a test can tune. A device only works while `On` is 1; power and errors
aren't modelled. Rates are per game tick (0.5 s) and scale with `dt`.

- `activeVent({ pressurePerTick })`, following the game's `ActiveVent`: attach it with
  `{ ports: { output }, room }`. While `On`, Outward (Mode 0) moves pipe gas into the room until
  the room reaches `PressureExternal`, keeping the pipe above `PressureInternal`; Inward (Mode 1)
  moves room gas into the pipe until the room falls to `PressureExternal`, keeping the pipe below
  `PressureInternal`. Each tick it moves at most `pressurePerTick` kPa of one grid cell (default
  10, a guess: the game keeps it in asset files). Changing `Mode` resets both limits to that
  mode's defaults (Outward 101.325 / 0 kPa, Inward 0 / 50,662.5), unless the script set one in the
  same tick.
- `poweredVent({ pressurePerTick })`: the same, with only `PressureExternal` (default 50 kPa a tick).
- `heatExchange(a, b, { fraction })`: two pipes, or a pipe and a room, move `fraction` of the way to
  a shared temperature each game tick, conserving energy.
- `volumePump({ maxSetting })`, `{ ports: { input, output } }`: moves `Setting` litres of the
  input's gas a tick (that share of its moles), against any pressure. `Setting` caps at 10.
- `pressureRegulator({ pressurePerTick })` and `backPressureRegulator(…)`, `{ ports: { input, output } }`:
  move gas until the output rises to `Setting` kPa (back pressure: until the input falls to it).
  Each tick at least `pressurePerTick` kPa of a 10 L segment (default 101.325, the code's default),
  or a quarter of what would even the pipes out when the input is higher.
- `filtration({ gases, pressurePerTick })`, `{ ports: { input, output, output2 } }`: while `On`
  with `Mode` 1, draws input gas (more the higher the input is above both outputs), sends the
  filtered gases and their liquid forms to `output` (the game's filter output) and the rest to
  `output2` (its waste). It reads the gas filters in slots 0 and 1 (`slot(0).put("ItemGasFilterOxygen")`;
  `Quantity` 0 is spent) unless `gases` names them. Filters don't wear out.
- `airConditioner({ pressurePerTick, temperatureDifferentialEfficiency, operationalTemperatureEfficiency })`,
  `{ ports: { input, output, output2 } }`: while `On` with `Mode` 1 and the input 1 K or more from
  `Setting` (kelvin), passes `pressurePerTick` kPa of 100 L of input gas to the output each tick,
  moving up to 14 kJ between it and the waste pipe (`output2`). Otherwise no gas passes. The
  efficiencies are set on the device: pressure (the game's: full with input and waste at 111 kPa or
  more), temperature differential (a guess: 1, falling to 0 at 200 K uphill) and operational
  temperature (a guess: 1). As in the game's code, a small flow can overshoot `Setting`.
- `battery({ generation, usage, capacity, lossPerTick })`: while `On`, charges from `generation`
  and supplies `usage` (watts, counted as joules per tick as the game does), each a number, device
  keys (their `PowerGeneration` / `RequiredPower`), `"key.Prop"` paths, or a function of the world.
  Sets `Charge`, `Maximum` (Station Battery 3.6 MJ, large 9 MJ, else the device's or `capacity`),
  `Ratio`, `PowerPotential`, `PowerActual` and the game's charge state in `Mode` (0 empty … 6 full).
  It loses 10 J a tick. No cable networks: name the devices.
- `dayNight({ dayTicks, startAt, room, temperature, sensors, irradiance })`, a world model: the
  weather timer. Over `dayTicks` (default 2400, the game's 1200 s day) a room's temperature follows a
  sine from `temperature.night` at midnight to `.day` at noon, and daylight sensors get `Activate`
  (sun up), `Vertical`/`SolarAngle` (from straight up; a guess at the game's convention),
  `Horizontal` and `SolarIrradiance`. `startAt` is where tick 0 falls: 0 midnight, 0.5 noon.
- `occupancySchedule(windows, { everyTicks })` for an occupancy sensor: `[{ from, to, people }]` in
  ticks sets `Quantity` and `Activate`, repeating every `everyTicks` if given.
- `larreDock({ stations, planters, dropOff, jammed, nodes, speed, looping, start, hand, extra, stackSize })`,
  for a hydroponics Larre, following the game's `RoboticArmDockHydroponics`. It returns state for the
  test to read as well as the model:

  ```ts
  const larre = larreDock({ stations: 17, planters: { 3: { mature: true, seeding: true, seeds: 1, harvest: 2 } }, dropOff: 15 });
  world.model("larre", larre.model);
  // larre.visited, larre.delivered, larre.hand, larre.extra, larre.station, larre.planter(3)
  ```

  Stations are the rail's junctions, 0 the starting dock. `Setting` picks one (clamped to the rail,
  wrapped on a loop) and the arm moves `speed` rail nodes a second (default 1, the code's) over
  `nodes` between stations (default 1, a guess: one number or by station), so 2 ticks a station.
  `Activate` is ignored while it moves; otherwise the arm goes down (1 s), acts, and comes up after
  0.2 s (1 s), `Idle` 0 throughout. At a planter an empty hand (slot 0) takes one item: a seed while
  the plant is seeding, else one fruit; a full hand adds to its stack, or moves to slot 1 first (if
  slot 1 is full, nothing happens). An empty hand destroys a plant with nothing to take. A seed in
  the hand plants an empty planter. At a drop-off the hand's whole stack goes into the import bin
  (a `jammed` bin keeps it, and takes nothing more). Slot 255 shows the plant at the arm (`Class`
  11, `Mature`, `Seeding` -1/0/1). Plants don't grow; seed and fruit counts are the test's to set.

## Env files

`World.fromEnv(env, options)` builds a world from the emulator's env JSON: an object, JSON text, or a
path relative to `root`. Devices are keyed by their `name` when it's unique, otherwise by reference
ID in `$hex` form (`world.device("$300")`); `{ testKeysById: { $300: "vent" } }` names them yourself. Chips
keep their starting registers and stack, and take the same options as `sim()`.

## Debugging

`sim({ debug: gate })` (or `setDefaultDebugGate(gate)`) installs hooks the scheduler awaits before every
line, on halts, on automatic yields, after each tick and after each scripted event. The VS Code debugger
will attach through this.

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
conditions and hovers see it: numbers, registers, aliases, defines, labels, `d0.On`, `db.Setting`, or any
world path.

While stopped, the agent shows a chip's scopes: Registers (with aliases; values that are reference IDs
labelled with their device), Stack (below `sp`, the top marked, and entries above it that hold something),
Devices (by pin, then `db`, then the rest of the network: ID, prefab, name, network, properties and slots; a
Logic Mirror shows its target), Atmospheres, World (tick, time, lines this tick, auto-yields, sleep, events
to come, models) and Defines. Registers, stack entries, device properties and slot values can be edited; a
new value is an expression on the chip (`Max`, `$1488`). Readings from a pipe or room can't. A hover on a
logic type's name shows its catalogue description.

Also exported: `createEnv` (a lower-level world from emulator env JSON), `readScript` / `findScripts`,
`parseId` / `formatId`, and `hash(name)`, the game's `HASH()`.

Runs as TypeScript source on Node 24+ (no build step yet). Its own tests run with `npm test` in this
directory, or `npm test -w ic10-test` from the workspace root; the root `npm test` runs them too.
