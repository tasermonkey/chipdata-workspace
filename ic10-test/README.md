# @tasermonkey/ic10-bench

Automated tests for your Stationeers IC10 scripts. You describe the devices a chip is wired to,
run the script for some game ticks, and check what it did: which devices it changed, what's in its
registers, whether it halted. Scripts run on an IC10 emulator that follows the game's rules (128 lines
a tick, errors halt the chip, and so on), in the [Vitest](https://vitest.dev/) test framework.

```ts
import { expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";

it("opens the vent when it gets hot outside", async () => {
	const world = await sim({ root: import.meta.dirname })
		.device("vent", "StructureActiveVent")
		.device("sensor", "StructureGasSensor", { Temperature: 300 })
		.housing("ic", { file: "vent.ic10", pins: { d0: "vent", d1: "sensor" } })
		.build();

	world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 450));
	await world.runTicks(30);

	expect(world.device("vent")).toHaveProps({ Mode: 0, On: 1 });
	expect(world.chip("ic")).toHaveRegister("OutsideTemp", 450); // aliases work
	expect(world.chip("ic")).toHaveNoErrors();
});
```

There's also a [VS Code debugger](../ic10-test-vscode/) for stepping through a script while its test
runs.

## Getting started

1. Install [Node.js](https://nodejs.org/) 24 or later.
2. In the folder with your scripts (run `npm init -y` first if it has no `package.json`):
   ```
   npm install --save-dev @tasermonkey/ic10-bench vitest
   ```
3. Add a `vitest.config.ts`:
   ```ts
   import { defineIc10Config } from "@tasermonkey/ic10-bench/config";

   export default defineIc10Config();
   ```
   That's Vitest's own config with the IC10 matchers added. Pass your usual Vitest options in it,
   e.g. `defineIc10Config({ test: { include: ["tests/**/*.test.ts"] } })`.
4. Add the scripts to your `package.json`, and two lines to your `.gitignore`:
   ```json
   "scripts": {
     "pretest": "ic10-bench catalog",
     "test": "vitest run",
     "test:watch": "vitest"
   }
   ```
   ```
   .ic10-bench/
   ic10-bench-env.d.ts
   ```
   `ic10-bench catalog` reads your Stationeers install for the descriptions of each device and
   property, and writes the types your editor uses (see [The device catalogue](#the-device-catalogue)).
   Those files hold the game's text, so they stay out of git.
5. Write a test, say `tests/airlock.test.ts` for `ic10/airlock.ic10`, and run `npm test`.
   `npx vitest run tests/airlock` runs just that one; `npm run test:watch` reruns as you edit.

Script paths are relative to `root`. `sim({ root: import.meta.dirname })` means "next to this test
file"; leave it out and they're relative to the folder you run the tests from.

## Building a world

`sim()` returns a builder. Add devices, then housings with chips in them, then `.build()`.

```ts
const world = await sim({ root: import.meta.dirname })
	.device("vent", "StructureActiveVent", { On: 0 })                     // key, prefab, starting values
	.device("light", "StructureWallLight", {}, { name: "Alarm" })          // a name for lbn / sbn
	.housing("ic", { file: "airlock.ic10", pins: { d0: "vent" } })       // the chip, and what's on its pins
	.housing("helper", { code: "s db Setting 1\nyield" })                 // or the script inline
	.build();
```

- The **key** (`"vent"`) is how the test refers to a device. It isn't the in-game name; give
  `{ name }` for that.
- The **prefab** is the game's prefab name. A typo, or a property the prefab doesn't have, is a
  compile error. Hovering a property shows what it is and whether
  it's read-only. `npx ic10-bench props <prefab>` lists them (see [Looking things up](#looking-things-up)).
- **Pins** map `d0`…`d5` to device keys. `db` is the housing itself; pass `props` to give it starting
  values.
- **Data networks.** If you don't declare any, every device shares one network, and batch
  instructions (`lb`, `sbn`, …) see them all. To build a base with separate networks, declare each
  one (`.network("base")`, `.network("outside")`) and put every device and housing on one of them
  with `{ network: "base" }`. A chip's batch instructions then only see devices on its own network,
  and, as in game, its pins can only be set to devices on its own network (anything else is a build
  error). To reach a device on another network, use a Logic Mirror (below).
- A housing's prefab defaults to the IC housing; pass `prefab` for another device that takes a chip
  (an air conditioner, a hardsuit).

**Mods' devices.** The console mod's parts (`ModularDevice…`), `StationBatteryNuclear` and
mirror-image layouts such as `StructureAirConditionerMirrored` work like any other prefab. For a
device the harness has never heard of, add `{ custom: true }`: it gets every logic property,
readable and writable, and its `PrefabHash` is `HASH(prefab)`.

```ts
.device("widget", "ModFutureWidget", { Setting: 1 }, { custom: true })
```

**Logic Mirrors** stand in for a device on another network:

```ts
sim()
	.network("base")
	.network("outside")
	.device("sensor", "StructureGasSensor", { RatioNitrogen: 0.7 }, { network: "outside" })
	.mirror("mirror", { target: "sensor", network: "base" })
	.housing("ic", { file: "x.ic10", network: "base", pins: { d0: "mirror" } })
```

Reads and writes through it go to the target, as in game. `world.mirror("mirror").setPowered(false)`
makes reads 0 and drops writes; `setTarget(key)` points it elsewhere.

**From an env file.** If you already have the emulator's env JSON, `World.fromEnv(env, options)`
builds a world from it. Devices are keyed by their `name` when it's unique, otherwise by reference
ID (`world.device("$300")`). `{ programs: { Controller: "controller.ic10" } }` runs a housing's chip
from a file.

## Running it

| Call | Does |
|---|---|
| `runTicks(n)` / `runSeconds(s)` | Advance game time. A tick is 0.5 s. |
| `runUntil(pred, { maxTicks })` | Run whole ticks until `pred(world)` holds. |
| `runUntilLine(labelOrIndex, { chip, maxTicks })` | Stop just before a chip runs that line. |
| `runToHalt({ maxTicks })` | Run until every chip halts or ends. For one-shot scripts. |
| `step(n, chip?)` | Run *n* lines of a chip, ignoring ticks. |

A run that goes too long (10,000 ticks by default) fails with a message showing every chip's state
and the last lines it ran, so a script stuck in a loop doesn't hang the test.

## Changing things while it runs

Between runs you can change anything directly:

```ts
world.device("sensor").set("Temperature", 280);       // read-only properties too
world.device("sorter").slot(0).put("ItemIronOre", { Quantity: 10 });
world.device("ic").set("On", 0);                      // switch a housing off; on again restarts the chip
world.chip("ic").setReg("Stage", 2);
```

Or schedule it. Events run at the start of a tick, before any chip:

```ts
world.at({ tick: 20 }, (w) => w.device("sensor").set("Temperature", 450));
world.at({ seconds: 60 }, ...);
world.every({ ticks: 60 }, (w) => w.device("sensor").add("Temperature", -40), { label: "nightfall" });
world.when((w) => w.device("vent").get("On") === 1, (w) => w.device("light").set("On", 1));
```

Each returns a function that cancels it.

## Checking results

Read values directly:

```ts
world.device("vent").get("Mode");
world.device("sorter").slot(0).get("Quantity");
world.chip("ic").reg("Stage");      // a register or alias
world.chip("ic").stackAt(4);
world.chip("ic").halted;
```

Or use the matchers, which explain what went wrong when they fail:

| Matcher | On | Passes when |
|---|---|---|
| `toHaveProps({ Mode: 1 })` | device, or chip (its housing) | Those properties have those values; others aren't checked. `expect.closeTo` works. |
| `toHaveRegister(name, v)` | chip | `r15`, `sp`, `ra` or an alias has the value. |
| `toHaveRegisterCloseTo(name, v, digits = 2)` | chip | Within `10^-digits / 2`. |
| `toHaveStack([...])` / `toHaveStackAt(i, v)` | chip | The stack below `sp` / one entry. |
| `toBeAtLine(index \| label)` | chip | It runs that line next, or halted on it. |
| `toHaveNoErrors()` | chip | Not halted, and no warnings (such as an alias that hides a built-in constant). |
| `toHaveHalted({ line, error })` | chip | Halted, optionally on that line with a matching message. |
| `toOnlyChange(paths, { since })` | world | Nothing else changed since a `world.snapshot()`. Paths can use aliases (`ic.Stage`) and `*`. |
| `toToggleAtMost(n)` | `world.record("vent.On")` | The value changed at most `n` times. Good for catching flapping. |
| `toNeverAutoYield()` | chip | Never ran out of its 128 lines in a tick. |
| `toAutoYieldAtMost(n, { perTicks })` | chip | At most `n` automatic yields, in total or in any window. |

A failure shows the chip's current line, its registers with their aliases, the stack, the devices on
its pins, and the last lines it ran.

## How it differs from what you might expect

- **Line numbers are 0-based** and count every line, comments and blanks included, like the game's
  `LineNumber`.
- **Comment, blank and label lines count toward the 128 lines a tick**, as in game.
- **A halt isn't a test failure.** The chip stops and the housing's `Error` goes to 1, as in game;
  check for it with `toHaveNoErrors()`. Build with `sim({ failOnHalt: true })` to fail at once instead.
- **Writing a property a device doesn't have, or a read-only one, halts the chip**, as in game. The
  message names the device and lists what it does have.
- **Switching a housing off and on restarts its chip** from line 0. Off and on again within one tick
  goes unnoticed, so a script restarting another chip has to `yield` in between.
- **Chips take turns in the order you declared them**, and each sees the others' writes at once.
- **`sleep` doesn't wait in real time**; it skips game ticks. A test of a script that sleeps for a
  minute still runs in milliseconds.

## Pipes, rooms and device behaviour

By default devices are just bags of values: a vent you switch on doesn't move any gas, and a sensor
reads whatever the test sets. When your script's logic depends on the physical result (it waits
for a pipe to empty, a room to warm up), give it gas to work on and models to move it.

```ts
const world = await sim({ root: import.meta.dirname })
	.pipe("coolant", { volume: 10 * PIPE_VOLUME, temperature: 150, pressure: 50, ratios: { CarbonDioxide: 1 } })
	.room("outside", { temperature: 150, pressure: 20, ratios: { CarbonDioxide: 95, Nitrogen: 5 } })
	.device("pa",   "StructurePipeAnalysizer", {}, { pipe: "coolant" })
	.device("vent", "StructureActiveVent",     {}, { ports: { output: "coolant" }, room: "outside" })
	.device("out",  "StructureGasSensor",      {}, { room: "outside" })
	.build();

world.model("vent", activeVent());
```

- `.pipe(key, …)` needs a `volume` (`PIPE_VOLUME` is one 10 L segment) and either `gases` in moles or
  `pressure` and `ratios`. `.room(key, …)` with a `volume` is a sealed room; without one it's outside
  air: too big for anything to change, so it only changes when the test sets new weather.
- Attach a device with `{ pipe }`, `{ room }` or `{ ports: { input, input2, output, output2 } }`.
  Its `Pressure`, `Temperature`, `TotalMoles` and `Ratio<Gas>` readings then come from the gas
  (with the port's suffix: `PressureOutput`, `RatioNitrogenInput`), and can't be `set` directly.
- `world.pipe(key)` and `world.room(key)` give the gas, and paths such as `coolant.Temperature` work
  in `record` and snapshots.

The gas is plausible, not exact: ideal gas, perfectly mixed, no condensing or boiling.

**Models** make devices act on the world each tick. A setting a script writes in one tick acts in
the next. Each only works while the device is `On`; power isn't modelled. Rates the game keeps in
asset files are guesses you can pass in.

| Model | For |
|---|---|
| `activeVent({ pressurePerTick })`, `poweredVent(…)` | Vents moving gas between a pipe (`output`) and a room, honouring `Mode` and the pressure limits. |
| `volumePump()` | `Setting` litres a tick from `input` to `output`. |
| `pressureRegulator()`, `backPressureRegulator()` | Gas from `input` to `output` until the output rises to / input falls to `Setting`. |
| `filtration({ gases })` | Filtered gases to `output`, the rest to `output2`. Reads the filters in slots 0 and 1 unless `gases` names them. |
| `airConditioner()` | Heats or cools gas from `input` to `output` toward `Setting` K, using `output2` as the waste pipe. |
| `heatExchange(a, b, { fraction })` | Two pipes, or a pipe and a room, moving toward a shared temperature. A world model: `world.model(heatExchange(...))`. |
| `battery({ generation, usage })` | Charge, `Ratio` and `Mode` from watts in and out (numbers, device keys or functions). |
| `dayNight({ dayTicks, room, temperature, sensors })` | A world model: day/night temperature on a room, and the sun on daylight sensors. |
| `occupancySchedule(windows)` | An occupancy sensor's `Quantity` and `Activate` over time. |
| `larreDock({ stations, planters, dropOff })` | A hydroponics Larre arm moving along its rail, planting and harvesting. |

Or write your own: `world.model("lamp", (lamp, dt, w) => { … })` runs every tick with the device,
the tick's length in seconds and the world.

## The device catalogue

The harness knows every device the emulator has: its logic types, whether each is readable or
writable, its slots and modes. `sim().device()` is type-checked against it, so a misspelt prefab or
property is an error in your editor, before the test even runs.

`npx ic10-bench catalog` (your `pretest` script) adds two things for your project:

- **Descriptions** of every logic type, from your Stationeers install: it finds the game through
  Steam, or set `STATIONEERS_DIR` to its folder. They show when you hover a property, and in
  `ic10-bench props`. Without the game everything still works, just without descriptions.
- **Your mods' devices**, if you've added any (next section).

It writes `.ic10-bench/catalog.json` and `ic10-bench-env.d.ts`. TypeScript picks up the
`.d.ts` as long as your `tsconfig.json` includes the project folder (the default does). Run it
again after a game update.

## Using modded devices

Devices from workshop mods aren't in the emulator, but you can add them, so a test can use them like
any other device:

1. Export the game's device list. Install the
   [StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor)
   BepInEx plugin (`StationpediaExtractor.dll` into `BepInEx/plugins/`), start the game with your
   mods, load a save, and run `stationpedia_export` in the F3 console. It writes
   `<Stationeers>/Stationpedia/Stationpedia.json` and `Enums.json` (which `catalog` also reads
   descriptions from).
2. In your project, run:
   ```
   npx ic10-bench import-mods
   npx ic10-bench catalog
   ```
   `import-mods` reads the export and writes every device the emulator doesn't have to
   `ic10-mods/<machine id>.json`: its name, hash, logic types with read/write, slots and modes (no
   game text). Pass the export's folder if the game isn't where Steam says:
   `npx ic10-bench import-mods "D:/Games/Stationeers/Stationpedia"`. `catalog` then adds them to
   the types.
3. Commit `ic10-mods/`. Each machine writes its own file (the id is random, and kept in
   `.ic10-bench/machine.json`), so two people with different mods never edit the same file; the
   harness reads them all, and yours wins where they disagree.

Then use them by prefab name:

```ts
const world = await sim()
	.device("button", "ModularDeviceRoundButton", { Activate: 1 })
	.housing("ic", { file: "button.ic10", pins: { d0: "button" } })
	.build();
```

Run both commands again after adding or updating a mod. Tests run with the devices in `ic10-mods/`
even before `catalog`; only the types need it.

For a device in no export at all, pass `{ custom: true }`: it gets every logic property, readable
and writable.

## Looking things up

`npx ic10-bench` answers "what does this device have?" without opening the game:

```
npx ic10-bench props StructureActiveVent    # logic types with R/W and descriptions, modes, slots
npx ic10-bench props round button           # search by words of the name
npx ic10-bench props 489382030              # by hash
npx ic10-bench logic PressureInternal       # what it is, and every prefab that has it
```

`checkBatchOps(source, loadCatalog())` checks a script's `lb`/`sb`-style instructions against the
devices they name, without running it: a logic type the prefab lacks, a write to a read-only one, a
`HASH()` of a prefab that doesn't exist. Run it over every script in a test to catch those early.

## Debugging

Install the [VS Code extension](../ic10-test-vscode/), set a breakpoint in your `.ic10` file, and
click **▶ Debug IC10** above the test. You can step line by line, watch registers and devices, and
step a tick at a time. Tests need no changes.

## Reference

**Device handle** (`world.device(key)`): `get`, `set`, `add`, `props(...)`, `id`, `idHex`, `name`,
`stackAt(i)` (the device's own memory, which `put` writes), `slot(i)` (`put`, `get`, `set`, `clear`,
`occupied`), and with gas attached `pipe`, `room`, `port(name)`, `readings`.

**Chip handle** (`world.chip(key)`): `reg`, `setReg`, `registers()`, `aliases()`, `defines()`,
`stack()`, `stackAt(i)`, `setStackAt(i, v)`, `sp`, `ra`, `line`, `findLabel`, `halted`, `halt`,
`errors`, `ended`, `sleeping`, `restarts`, `autoYields`, `recentLines(n)`, `status`, `db`, `pins`.

**World**: `tick`, `listDevices()`, `listChips()`, `deviceById(id)`, `network(id).byName(...)` /
`.byType(...)`, `snapshot()` / `diff(before)`, `record(path)`, `listEvents()`, `listModels()`,
`refreshReadings()` (show a gas change on devices before the next tick).

**`sim()` options**: `root`, `failOnHalt`, `maxTicks` (default 10,000), `maxLinesPerRun` (default
1,000,000), `tickSeconds` (default 0.5), `countNonInstructionLines` (default true),
`restartClearsState` (default false).

**Also exported**: `hash(name)` (the game's `HASH()`), `readScript`, `findScripts`, and the gas
classes `Mixture` and `Reservoir` for working with gas outside a world.

Working on the harness itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
