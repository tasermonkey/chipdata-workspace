# IC10 Test Framework: Plan

The goal is a way to write automated tests for the scripts in [ic10/](ic10/). Each test should:

1. describe an emulated game state: networks, devices, their property values, and pipe and room
   atmospheres;
2. run an IC10 script against that state under the game's real execution rules (game ticks,
   auto-yield after 128 lines, `sleep`, halting on errors), for a set number of lines or ticks or until
   a condition holds;
3. change the world while the script runs (scripted events and simple device behaviour);
4. assert on the result: device properties, registers (by name or alias), the stack, errors, and
   which values changed over time.

The plan builds on a fork of [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10)
(TypeScript, AGPL-3.0). Engine findings come from reading its source and running a spike against your
scripts on 2026-10-07 (see the Appendix).

## Decisions (2026-10-07)

| Topic | Decision |
|---|---|
| Test style | TypeScript tests using **Vitest** (`describe` / `it` / `expect`) with custom matchers. |
| Location | In this repo, in a **self-contained subdirectory** that can later move to its own repo. |
| Emulator | **Fork** Stationeers-ic/ic10. We may release the fork later under AGPL-3.0. We're not planning upstream PRs. |
| Toolchain | **Node 24+ and npm only, no Bun.** Scripts are written in TypeScript and run natively with Node's type stripping. The fork is converted too. |
| Packaging | The fork must be **real ESM**, loadable by plain Node. |

---

## 1. What the emulator already does

| Capability | Evidence |
|---|---|
| Parses and executes IC10 | Before the Phase 1 fixes, 31 of your 38 scripts passed its validator: G6 failed 2 and G10 failed 4. (The earlier spike counted 37, because it ran the older published build.) With G6 and G10 fixed, 37 pass. The one failure is Alaska's real `move stage 0` bug, and `tests/scripts-load.test.ts` checks this. |
| Device catalogue | 300+ prefabs generated from game data, each with its logic types, Read/Write permissions, slots, connections and modes. |
| Networks and pins | `d0`–`d5`, `db`, and networks of type data, power, pipe, chute and others. Devices have typed ports (`Pipe Input`, `Pipe Input 2`, `Pipe Output`, `Pipe Waste` and so on). |
| `l`/`s`, `lb`/`sb`, `lbn`/`sbn` | Your VCCR script ran correctly in night and day modes. `sbn` updated only the named vents. |
| Environment file | JSON with `chips`, `devices` (`props`, `slots`, `reagents`, `pins`) and `networks`. Loaded by `Builder.from(json)` (upstream spells it `Builer`; renamed in the fork). |
| Stepping and events | `Ic10Runner.step()`, with events for line, register, stack and device reads/writes, and errors. |
| Built-in constants | `Color.*`, `LogicBatchMethod.*`, `GasType.*` and others (about 680). |
| Game-exact math | Uses `exact-ic10-math`, a port of the game's C# math. |

## 2. Gaps found

| # | Gap | Effect | Where it's fixed |
|---|---|---|---|
| G1 | No tick model: `yield` is a no-op and there's no 128-line auto-yield. | "Run N ticks" has no meaning, and preemption can't be tested. | Fork hook plus harness scheduler (§4.2) |
| G2 | `sleep` calls a real `setTimeout`, with the seconds multiplied by 1000 twice. | `sleep 5` makes the test wait 5,000 real seconds. | Fork hook (**done**) plus virtual clock |
| G3 | A cumulative 1000-jump limit. | Every `j start` loop dies with a critical error. The spike was killed after about 3,000 lines. | Harness creates runners with no jump limit and uses its own budgets (§4.3) |
| G4 | Strong runtime errors don't halt. | `move stage 0` logs an error and keeps going, but in game the chip stops. | Harness halts the chip and records it, so tests can assert on it (§4.5) |
| G5 | The validator misses undefined identifiers. | `move stage 0` validates cleanly. | Fork (sandbox check) or harness lint |
| G6 | `define X 0` is rejected. | `DefineInstruction` checks `if (value)`, so 0 is treated as missing. Solar and Landing Bay fail to load. | **Fixed in fork** (`value !== false`, plus `tests/ic10/fork-fixes.test.ts`) |
| G7 | Packaging and initialisation. | The ESM build has extensionless imports and won't load in Node. `Builder.init()` sandbox pass throws `no_network_for_port`. i18n is never initialised. | Fork (§3) |
| G8 | Devices are property bags with no behaviour. | Turning a vent on doesn't move any gas. | Harness world model (§5) |
| G10 | **`ld` and `sd` don't work at all.** `calculateDevicePinOrId` turns a failed pin parse into error code `0`, then treats that as pin 0, so it never tries the ID lookup. `ld r3 $1488 On` and `ld r3 r1 On` both fail with `pin_not_allowed_in_instruction`. | Printer Control can't run (line 38 `ld Tmp Param1 On`), nor can anything else using reference IDs. Device-ID arguments also rejected `define`d IDs (`define DEBUG_1 $4D655` / `sd DEBUG_1 …`). | **Fixed in fork**: a failed pin parse falls through to the ID lookup, and device-ID arguments accept defines. Covered by instruction tests and `fork-fixes.test.ts`. |
| G12 | No **Logic Mirror** in the emulator or its game data. | Scripts that read another network through a mirror can't be tested. | Fork extension point (proxy device) + harness (§5.4) |
| G11 | Instruction errors can **throw out of `step()`** instead of being recorded. | One bad line crashes the test with a JS stack trace instead of halting the chip. | **Fixed in fork** (catch in `step()`); the harness also catches as a safety net |
| G13 | **`jal` and the branch-and-link instructions store the wrong return address**: their own line instead of the next one. Upstream's `beqal` test expected the wrong value. | `j ra` jumps back to the `jal`, so a `jal sub` … `j ra` loop never gets past the call. 31 of the 38 scripts use `jal`. Found by the first `sim()` test in which day comes partway through the run. | **Fixed in fork** (`ra` = line + 1), with tests in `fork-fixes.test.ts` |
| G14 | **Batch reads of no devices all return 0.** In game `Average` is NaN (0 / 0) and `Maximum` is −∞; `Sum` and `Minimum` are 0 (per [dcramer/stationeers](https://github.com/dcramer/stationeers/blob/main/docs/ic10-instructions.md#device-access-and-missing-batch-data), unofficial). | The mixer scripts' "NaN means a missing device" check never fires, so a missing tank looks like the mixer being off. Found writing the review 1.11 test. | **Fixed in fork**, with tests in `fork-fixes.test.ts` |
| G15 | **The "is a device set" instructions error on an empty pin.** `sdse`, `sdns`, `bdse`, `bdns`, `brdse`, `brdns`, `bdseal` and `bdnsal` required a device on the pin, so testing for one halted the chip. | The Arc Furnace script loops over d0–d5 with `bdns dr0` and halted at the first empty pin. | **Fixed in fork**: those instructions take a pin that may be empty, with tests in `fork-fixes.test.ts` |
| G16 | **Slots the game data lists no logic types for read 0.** The Larre's Target Slot (255, the plant at its arm) is one. | `ls r1 larre 255 Mature` always read 0. | **Fixed in fork**: such a slot reads whatever its item has; slots that list their logic types are unchanged |
| G17 | **`sdse` / `sdns` take only a pin.** The wiki gives them `device(d?\|r?\|id)`, so the game also accepts a reference ID (set = on the network). | `sdse r0 $1488` fails in the emulator. No script uses it yet. | Fork, when a script needs it |
| G9 | Toolchain is Bun-only. | Tests import `bun:test`, scripts run with `bun tools/*.ts`, there's a `bunfig.toml`, and CI uses Bun. | Fork conversion (§3) |

---

## 3. The fork: convert to Node 24 + npm + ESM

This is the largest up-front piece of work. The Bun dependence turned out to be fairly shallow:

| Item | Today | Change |
|---|---|---|
| Test runner | 9 files import `bun:test`, plus `tests/setup.ts` and `bunfig.toml`. | Switch to Vitest; the APIs are nearly identical. `bunfig` preload becomes `setupFiles`. Snapshots are regenerated. |
| Tool scripts | `bun tools/*.ts` (download, generate-*); `tools/whatch.ts` uses the Bun API. | `node tools/*.ts` using Node 24 type stripping. Rewrite the watcher with `fs.watch`. |
| Import aliases | **462 files** import via `@/…`, which Node can't resolve. | Codemod to relative imports **with `.ts` extensions**. Build with `rewriteRelativeImportExtensions` so the published JS imports `.js`. This is also the ESM fix (G7). |
| TS-only syntax | `enum` or `namespace` in `Errors.ts`, `Stack.ts` and `ParserV1.ts`. | Convert to `as const` objects, so Node's strip-only mode can run the source directly. |
| Lockfile and CI | `bun.lock`; the workflow uses Bun. | `package-lock.json`; the workflow uses `actions/setup-node` with Node 24. |
| Build | Vite plus `tsc` plus `tsc-alias`. | Keep Vite (it runs on Node) or switch to plain `tsc`. `tsc-alias` is no longer needed. |

The fork then gets the engine fixes:

1. **Suspend signal (G1, G2).** `yield` and `sleep(s)` record a pending suspend instead of doing
   nothing or calling `setTimeout`. `step()` exposes it, and the harness scheduler acts on it.
   *Done (fork side):* after each `step()`, `runner.suspend` is `{ kind: "yield" }`,
   `{ kind: "sleep", seconds }` or `null`, and a `suspend` event fires. `sleep 0` (or negative) acts as a `yield`, as in game (confirmed
   2026-10-07).
   This also fixed upstream's `sleep N`, which multiplied by 1000 twice (N × 1000 real seconds).
   The 128-line auto-yield and the virtual clock belong to the harness scheduler (Phase 2).
2. **`define` zero (G6).** Done: `parseArgumentAnyNumber` returns `false` on failure, so the check is `value !== false`.
3. **Initialisation (G7).** Fix the sandbox network lookup and default i18n to English. *Done:*
   `src/Languages/lang.ts` initialises synchronously in English when loaded, with every bundled
   language available through `i18n.changeLanguage()`.
4. **`ld` / `sd` by reference ID (G10).** Only treat the argument as a pin when `getDevicePin`
   succeeds, otherwise resolve it as an ID (a literal like `$1488` or `5256`, or a register holding
   one). Add tests for literal, hex, register, and an unknown ID. *Done.* Side effect: `l` and `s`
   share the same argument type, so `l r0 r14 Activate` (Fab Room line 45) now works too. That is
   correct: the in-game docs give `l r? device(d?|r?|id) logicType`, so `l`/`s` accept a register
   or a reference ID as well as a pin (confirmed 2026-10-07).
5. **Errors never escape `step()` (G11).** Catch instruction exceptions and record them as chip errors.
   *Done:* anything thrown while a line runs (an `Ic10Error`, a plain `Error`, even a bare string)
   becomes a **critical** error on that line. The chip stops, `step()` returns `false`, and
   `error` → `fatalError` → `stop` are emitted. The jump-limit error now has `code: "JUMP_LIMIT"`,
   so `Builder.init()` can reject scripts whose validation pass threw, while still accepting
   endless loops. `DeviceSlots` throws a real `Error` instead of a string.
6. **Undefined identifiers (G5).** Report them in the sandbox pass. *Optional; the harness lint can
   cover this instead.*

**Divergence risk.** Converting 462 files makes it hard to merge future upstream changes. Most of
those changes will be game-data refreshes, which come from the fork's own `download` / `generate`
tools, so we mostly regenerate rather than merge. Keep the codemod as a **re-runnable script** in the
fork (`tools/codemod-esm.ts`), so it can be re-applied to a fresh upstream checkout if needed.

---

## 4. Harness design

### 4.1 Layout
```
chipdata-workspace/
├── package.json              # npm workspaces: ["ic10-test", "vendor/ic10"]; "test": "vitest"
├── vitest.config.ts          # includes tests/**/*.test.ts; loads ic10-test matchers
├── vendor/ic10/              # git submodule → your fork
├── ic10-test/                # THE HARNESS: self-contained package, movable later
│   ├── package.json          # name e.g. "@tasermonkey/ic10-test"; depends on the fork
│   ├── src/
│   │   ├── engine/           # adapter: the ONLY code touching emulator internals
│   │   ├── world/            # World builder, devices, pipes/rooms, events, models
│   │   ├── scheduler/        # ticks, auto-yield, sleep, budgets
│   │   ├── matchers/         # Vitest expect.extend matchers
│   │   ├── catalog/          # device and property metadata (§6)
│   │   ├── debug/            # debug gate + socket server used by the adapter (§6b)
│   │   └── lint/             # static checks (later)
│   ├── vscode/               # VS Code extension: DAP adapter, CodeLens, grammar (§6b)
│   └── test/                 # the harness's own tests
└── tests/                    # tests for YOUR scripts, mirroring ic10/
    └── ClimateControl/VCCR-cooling.test.ts
```
Moving `ic10-test/` to its own repo later only means changing its fork dependency from a workspace
reference to a git URL.

### 4.2 Execution model: game ticks
- **1 tick = 0.5 s of game time** (`tickSeconds`, configurable). In each tick, every chip runs until
  one of these happens:
  - `yield`: the chip is done for this tick.
  - `sleep n`: the chip is parked until virtual time reaches `now + n`.
  - **128 lines executed: automatic yield.** The chip resumes at the next line on the next tick.
  - A halt: an error, or running off the end of the script.
- **World events and device models run between ticks**, so the world can change between any two
  slices of 128 lines, as it can in game.
- With several chips, they run in a fixed, configurable round-robin order within each tick.
- **Comment, label and blank lines count toward the 128 by default**, matching the game (confirmed
  2026-10-07) and Ryex's ic10emu (it compiles every source line, including blanks and comments, to a
  `Nop` step). It stays configurable. Developers can change both settings, per world or per chip:
  ```ts
  sim({ linesPerTick: 128, countNonInstructionLines: true })   // defaults
  ```
  With `countNonInstructionLines: false`, only instruction lines use up the budget.

**Where these numbers come from.**

| Rule | Source | Confidence |
|---|---|---|
| 1 tick = 0.5 s | Stationeers wiki energy reference ("1 Watt per 0.5 real time seconds"). The game's own text only says `yield` "Pauses execution for 1 tick", with no length. | Good, but secondary |
| At most 128 lines per tick, then auto-yield with no error | Ryex/ic10emu `run_programmable`: 128 steps, then state `Yield`. Forum posts describe the same rule. | Good |
| Blank, comment and label lines count | Confirmed in game (2026-10-07). ic10emu also compiles them to `Nop` steps. | Confirmed |
| An error stops the chip and sets the housing's `Error` to 1 | ic10emu `step()` | Good |

One guide claims that hitting 128 lines throws a "too many operations" error instead of
auto-yielding. Nothing else supports it, so it may describe an older game version.

**In-game check (5 minutes, settles all of it).** Run each script for 60 real seconds and read
`db Setting`:

```
# A: tick length. Expect about 120 after 60 s (2 ticks per second).
loop:
yield
add r0 r0 1
s db Setting r0
j loop
```
```
# B: 128-line auto-yield. No yield; 4 lines per pass, so about 32 passes per tick.
# Expect about 120 × 32 = 3,840 after 60 s, and no error.
loop:
add r0 r0 1
s db Setting r0
j loop
```
- Add 4 comment lines inside B's loop. If comments count, the result roughly halves (about 1,920).
- If B shows an error instead of counting, the game errors at 128 lines rather than auto-yielding.

**Testing preemption.** The scheduler counts auto-yields per chip, and the matchers expose them:

```ts
expect(chip).toNeverAutoYield();                // every loop path hits a yield/sleep
expect(chip).toAutoYieldAtMost(1, { perTicks: 10 });
```

There's also a **preemption sweep**. It re-runs a scenario with a world event injected at each
possible preemption point, then checks that the outcome is the same. This catches scripts that read
several devices across a 128-line boundary and act on an inconsistent snapshot.

### 4.3 Run controls and budgets (the "timeout" equivalent)
Every run call has a game-time budget. Exceeding it **fails the test with a trace**, the way Vitest's
`timeout` does, except it's measured in ticks and lines instead of milliseconds.

| Call | Meaning |
|---|---|
| `step(n = 1, chip?)` | Execute *n* lines, ignoring ticks. |
| `runTicks(n)` / `runSeconds(s)` | Advance game time. |
| `runUntil(pred, { maxTicks })` | Run until `pred(world)` is true; fail if `maxTicks` passes first. |
| `runUntilLine(label \| index, { maxTicks })` | Run until the chip is about to execute that line. |
| `runToHalt({ maxTicks })` | For one-shot scripts (Printer Setup, Mars CO2). |

Defaults come from `sim({ maxTicks: 10_000, maxLinesPerRun: 1_000_000 })`. Vitest's wall-clock
`timeout` still applies as a final safety net.

### 4.4 World builder and accessors
```ts
import { describe, it, expect } from "vitest";
import { sim } from "@tasermonkey/ic10-test";

describe("VCCR Cooling Air Management", () => {
  it("pulls in night air when it's cold outside", async () => {
    const world = await sim()
      .network("data")
      .device("vent",   "StructureActiveVent", { TemperatureOutput: 500, PressureOutput: 1000 })
      .device("sensor", "StructureGasSensor",  { Temperature: 300 })
      .housing("ic", {
        file: "ic10/ClimateControl/VCCR Cooling Air Management (1) [22840].ic10",
        pins: { d0: "vent", d1: "sensor" },
      })
      .build();

    await world.runTicks(1);

    expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
    expect(world.chip("ic")).toHaveRegister("OutsideTemp", 300);   // alias → r0
    expect(world.chip("ic")).toHaveNoErrors();
  });
});
```

- A chip's program comes from exactly one of:
  - `file`: a path to an `.ic10` file, resolved from the repo root. Error messages and the debugger
    point at that file.
  - `code`: inline IC10 source as a string. Handy for small harness tests and for trying a snippet:
    ```ts
    .housing("ic", { code: "alias Stage r15\nmove Stage 1\nyield", pins: {} })
    ```
  Passing both, or neither, is a build error. The names match the existing env formats: upstream's
  env JSON uses `code`, and vscode-ic10's uses `file`.
- **Device identity.** Every device, housings included, has three ways to be found:

  | | Used by | Set with |
  |---|---|---|
  | Test-side key, e.g. `"vent"` | The test: `world.device("vent")`, `pins: { d0: "vent" }` | First argument |
  | In-game `name` | `lbn` / `sbn` / `lbns` (name hash) | `{ name: "Coal Chute Low Marker" }` |
  | **Reference ID** | `ld` / `sd`, IDs stored in registers or on the stack, the `ReferenceId` property | `{ id: "$1488" }` or `{ id: 5256 }` |

  These go in an optional fourth argument, so the third stays purely the device's properties (and
  keeps its typing from the catalogue, §6):
  ```ts
  .device("lathe1", "StructureAutolathe", { On: 1 }, { id: "$1488", name: "Autolathe 1" })
  .housing("control", { file: "…/VCIC - Printer Control.ic10", id: "$B0D98" })
  ```
  - IDs accept a number or the game's `$hex` form, exactly as you'd copy it from the tablet.
  - Devices without an `id` get a **deterministic** one from a fixed sequence, so tests and failure
    messages are stable from run to run.
  - Duplicate IDs are a build error.
  - `world.device("lathe1").id` returns it, and failure reports and the debugger show IDs in `$hex`.
  - `ld`/`sd` only find devices on the **housing's data network**, which matches the game and the
    emulator. An unknown ID or a device on another network is an error. The one in-game exception
    is the **Logic Mirror** (§5.4).
  - With more than one network, each device says which one it's on:
    `{ network: "outside" }`. With a single data network, that's the default.
- **Devices the emulator doesn't know** (console-mod parts, `StationBatteryNuclear`) are a build
  error unless marked `{ custom: true }`. A custom device's PrefabHash is `HASH(prefab)`, so batch
  instructions find it by type and name, and it accepts every logic property, readable and
  writable. Phase 5's catalogue can tighten that to the real property lists.
- The chip can live in a device that holds a chip (an AC unit or filtration unit), and then `db` is
  that device.
- **Chips that configure other chips.** A housing can be pinned to another housing, and `put` / `get`
  read and write that chip's stack. This was verified in the spike: `put d0 1 77` from one chip, then
  `get r3 d0 1`, reads back 77, and the target chip's stack holds it. That covers your Printer
  Setup → Printer Control pair:
  ```ts
  it("turns a fabricator off when its power switch is off", async () => {
    const world = await sim()
      .network("data")
      .housing("control", { file: "ic10/FabControl/VCIC - Printer Control.ic10" })
      .housing("setup",   { pins: { d0: "control" }, code: `
          put d0 0 1           # one fabricator
          put d0 1 $1488       # printer
          put d0 2 $3606       # stacker
          put d0 5 $AE87A      # power switch
          # …remaining slots for this fabricator
      ` })
      .device("lathe1",  "StructureAutolathe", {},       { id: "$1488" })
      .device("stacker", "StructureStacker",   {},       { id: "$3606" })
      .device("power",   "ModularDeviceFlipCoverSwitch", { On: 0 }, { id: "$AE87A", custom: true })
      // …
      .build();

    await world.chip("setup").runToHalt({ maxTicks: 1 });          // setup writes the IDs
    expect(world.chip("control")).toHaveStackAt(1, 0x1488);

    await world.runTicks(2);
    expect(world.device("power")).toHaveProps({ Color: 4 });        // Color.Red: switched off
  });
  ```
  The inline `code` setup keeps the test small. Pointing `file` at the real `VCIC - Printer
  Setup.ic10` also works, but then every ID it lists needs a matching device.
- Test-side writes bypass read-only permissions, just as the game updates sensor readings.
- Accessors:
  - `chip.reg("Stage" | "r15")`, `.sp`, `.ra`, `.stack(i)`, `.line`, `.errors`, `.halted`;
  - `world.db("ic")`;
  - `world.network("data").byName(...)` / `.byType(...)`;
  - `device.slot(i)`.
- **Snapshots, diffs and history.**
  - `world.snapshot()` / `world.diff(s)` record exactly which device properties and registers changed.
  - `world.record("vent.On")` gives one value per tick, for assertions such as "toggles at most twice in
    20 ticks" (the check that catches the Suit MKII chatter).
- Script loading normalises CRLF line endings, and `World.fromEnv(json)` loads upstream env files.

### 4.5 Errors behave like the game
- Strong and critical errors **halt the chip**: it stops executing and the housing reports the error
  and line. ic10emu sets the housing's `Error` to 1 and leaves the chip's line pointer on the failing line.
  Mirror that, and confirm in game when convenient.
- A halt is **not** an automatic test failure. It's state you assert on:
  ```ts
  expect(world.chip("ic")).toHaveHalted({ line: 57, error: /register/ });   // 0-based: editor line 58
  expect(world.chip("ic")).toHaveNoErrors();     // the usual assertion
  ```
- `sim({ failOnHalt: true })` is available for tests that want any halt to fail immediately.
- **Switching a housing off and on restarts its chip** from line 0, which is also how a halted chip
  gets going again. Another chip does it with:
  ```
  s otherHousing On 0
  yield
  s otherHousing On 1
  ```
  The harness reads a housing's `On` at the start of its chip's turn. While it's 0, the chip is
  skipped. When it's found back at 1, the chip restarts: the halt is cleared, the housing's `Error`
  goes back to 0, and defines and aliases are rebuilt as the script runs again. Switching off and on
  within one turn isn't noticed, which is why the `yield` is needed. Housings start switched on
  unless built with `On: 0`.

  This applies to IC housings only. On other devices that take a chip, `On` is the device's own
  function: a hardsuit's is its A/C ("Controls A/C power for the suit", per the wiki), and the MKII
  suit script switches it off and on while its chip keeps running. An AC unit's `On` is treated the
  same way, which is unconfirmed in game.

  **Open question:** whether a restart keeps registers and the stack. The default keeps them, and
  `restartClearsState: true` (per world or per housing) clears them. In-game check: run
  `add r0 r0 1` / `s db Setting r0` / `yield` / `j 0`, switch the housing off and on, and see whether
  `Setting` carries on counting or starts again from 1.

### 4.6 Matchers (Vitest `expect.extend`)
`toHaveProps`, `toHaveRegister`, `toHaveRegisterCloseTo`, `toHaveStack`, `toHaveStackAt(i, v)`, `toBeAtLine`,
`toHaveNoErrors`, `toHaveHalted`, `toOnlyChange([...])`, `toToggleAtMost(n)`, `toNeverAutoYield`,
`toAutoYieldAtMost`.

Each matcher is backed by a plain function, so the logic isn't tied to Vitest. When a matcher fails,
the report shows the line number and source text, registers with their aliases, the last N executed
lines, auto-yield count, and the relevant device properties.

---

## 5. World behaviour: events, device models, atmospheres

This lets a test dictate what happens in the world while the script runs.

### 5.1 Scripted events
```ts
world.at({ tick: 20 },       w => w.device("sensor").set("Temperature", 450));   // day comes
world.every({ ticks: 10 },   w => w.device("battery").add("Charge", -500));
world.when(w => w.device("door").get("Open") === 1, w => w.room("hangar").vent());
```

### 5.2 Device models
These are per-tick callbacks for how a device reacts to what the script sets. They're plausible, not
physically exact.

```ts
world.model("vent", (v, dt, w) => {
  if (v.On && v.Mode === 1) w.pipe("cooling").transferFrom(w.room("outside"), 5 /* mol/s */ * dt);
});
```

Ship a small library of reusable models: active and powered vents, pumps, filtration (moves one gas
type), AC (moves heat), battery (charge from generation minus usage), occupancy schedule, and
weather timer.

### 5.3 Atmospheres: pipes and rooms
This covers changing gas ratios and temperature:

```ts
world.pipe("waste", { volume: 100, temperature: 310,
                      gases: { CarbonDioxide: 40, Nitrogen: 10, Pollutant: 2 } });  // moles
world.room("outside", { volume: Infinity, temperature: 300, gases: { CarbonDioxide: 95 } });

world.at({ tick: 5 }, w => w.pipe("waste").addGas("NitrousOxide", 3).setTemperature(280));
```

- An ideal-gas mixture (P = nRT/V) gives each network `Pressure`, `Temperature`, `TotalMoles` and
  `Ratio<Gas>`.
- Devices attached to that pipe network **derive their port-specific properties automatically**:
  `Pipe Input` → `PressureInput`, `RatioNitrogenInput`, `TemperatureInput`; `Pipe Input 2` →
  `…Input2`; `Pipe Output` / `Output2`, and so on. A filtration unit's `RatioNitrogenInput` follows
  the pipe's composition. Gas sensors read their room.
- Models (§5.2) move moles and heat between pipes and rooms, which closes the loop. A vent on the
  Alaska cooler really does cool the pipe over N ticks.

### 5.4 Logic Mirror (devices on another network)

From the [wiki](https://stationeers-wiki.com/Logic_I/O#Logic_Mirror): a Logic Mirror sits on one
data network and **stands in for a single target device on another network**. The target is chosen
with a screwdriver. Reads and writes through the mirror act on the target "as if the target device
itself is present in the logic network". It needs power (10 W), and unpowered it returns no data.
Known bug: it doesn't forward `ls` (slot reads).

**Neither the emulator nor its game-data source has this device**, so the harness defines it as a
proxy device in the engine adapter: a `StructureLogicMirror` whose property reads and writes are
forwarded to the target. The fork needs a small extension point for that: a device whose `props`
read and write through hooks.

```ts
const world = await sim()
  .network("base")
  .network("outside")
  .device("sensor", "StructureGasSensor", { RatioNitrogen: 0.7 }, { network: "outside" })
  .mirror("mirror", { target: "sensor", network: "base" })        // powered by default
  .housing("ic", { code: "l r0 d0 RatioNitrogen\nyield", pins: { d0: "mirror" } })
  .build();

await world.runTicks(1);
expect(world.chip("ic")).toHaveRegister("r0", 0.7);

world.device("mirror").setPowered(false);
await world.runTicks(1);
expect(world.chip("ic")).toHaveRegister("r0", 0);                  // unpowered: no data
```

**Behaviour, with the parts the wiki doesn't settle.** Each unsettled item is a world option, so a
test can switch it once it's been checked in game.

| Through the mirror | Default | Basis | Option |
|---|---|---|---|
| `l`/`s` on a pin set to the mirror, and `ld`/`sd` with the **mirror's** reference ID | Forwarded to the target | Wiki | — |
| Mirror unpowered | Reads return 0, writes are dropped | Wiki says "no data"; 0 rather than an error is a guess | `mirror.unpoweredReads: "zero" \| "error"` |
| `ls` / `ss` (slots) | **Not** forwarded; returns 0 | Wiki "Bugs" section | `mirror.forwardSlots` |
| `PrefabHash`, `ReferenceId`, `NameHash` read through it | The target's | Guess from "as if the target is present" | `mirror.identity: "target" \| "mirror"` |
| `lb`/`sb`/`lbn` on the mirror's network using the **target's** prefab or name | Not visible; batch ops see a Logic Mirror, not the target | Guess | `mirror.visibleToBatch` |
| `ld` on the mirror's network using the **target's** own reference ID | Not found | Guess | `mirror.targetIdVisible` |
| No target set | Reads 0, writes dropped | Guess | — |

The debugger shows a mirror as `mirror → sensor (outside)`, with the target's properties nested
underneath.

---

## 6. Device and property catalogue

This makes it easy to see what properties a device has, and to validate that scripts use real ones.

### Data sources
| Source | What it gives | Freshness / licence |
|---|---|---|
| Fork's game data (`assets.ic10.dev`, via `tools/download.ts`) | Per prefab: logic types with Read/Write, slots and their logic types, modes, connections. | Kept current by the fork's download tool. |
| **Your game install:** `…/Stationeers/rocketstation_Data/StreamingAssets/Language/english.xml` | **Descriptions:** 287 `LogicType…` records, e.g. `LogicTypeRatioNitrogenInput` → "The ratio of nitrogen in device's input network". It also has slot types and device descriptions. | Always matches your game version (file dated 2026-08-22). It's game text owned by RocketWerkz, so **extract at build time and gitignore the output**; don't commit it. |
| **Stationpedia export** ([Ryex/StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor), a BepInEx plugin; `stationpedia_export` in the F3 console writes `Stationpedia/Enums.json` and `Stationpedia.json`) | A description for every logic type, and each loaded prefab's logic types and slots, possibly including mods' devices. | Your game version, whenever you run it. Game data: the descriptions stay local; mod devices' names and Read/Write go into committed `ic10-test/data/mods/`. |
| [Stationeers wiki](https://stationeers-wiki.com/Filtration) device pages | **Per-device**, human-written descriptions with units and ranges, e.g. Filtration → `RatioNitrogenInput`: "Percentage of Nitrogen in input as ratio between 0 and 1". Richer than the game's generic one-liners. | Community-maintained: some entries are "Unknown", a few disagree with other pages or the game, and some may lag game updates. The site's Cloudflare bot check blocks scripted access. **Licensed CC BY-SA and GFDL** (from the site's disclaimer). |

A `catalog:build` script merges these into `ic10-test/generated/catalog.json`. It finds the game
through `STATIONEERS_DIR` or the default Steam path. Without the game or an export (e.g. in CI)
there are no descriptions; types and Read/Write checks work the same.

ic10emu's descriptions were used as a fallback in step 1, then dropped: they're an older run of the
same Stationpedia export (ic10emu's `xtask generate` reads `Enums.json` and `Stationpedia.json`).

**Working from a clean clone** needs neither the mod nor an export: `npm install`, then `npm test`.
The committed fork data and `data/mods/` give every type. **Refreshing** after a game update or a
new mod: run the export in game, then `npm run catalog:import-stationpedia` to regenerate `data/mods/`,
and commit it. Whoever has an export locally also gets its descriptions in their build.

**How descriptions combine.** The catalogue keeps every source's text with a source label instead of
picking one winner:

```
RatioNitrogenInput   (StructureFiltration)   Read
  wiki: Percentage of Nitrogen in input as ratio between 0 and 1
  game: The ratio of nitrogen in device's input network
```

- The **game and fork data decide** which properties exist and their Read/Write permissions, because
  they match the installed game version.
- **Wiki text is shown first** in hovers and the CLI when present, because it's per-device and
  includes units and ranges. Game text is shown alongside it, and game text is used alone when the
  wiki has nothing.
- If the wiki lists a property the game data doesn't have, or the reverse, `catalog:build` prints a
  warning. That's a cheap way to spot stale wiki entries or renamed properties.

**Getting wiki data without scraping.** We respect the bot check rather than work around it:

1. **Manual export (start here).** In a browser, use the wiki's `Special:Export` page to export the
   device pages you care about as one XML file. Drop it in `ic10-test/data/wiki/`, which may be
   committed under the licence rules below. `catalog:build` parses the device parameter tables from
   the page source.
2. Do this per device as you write tests. It doesn't need to be complete, because game text covers
   the gaps.
3. If the wiki offers a supported dump or API access later, swap that in.

**Licence handling.** The wiki's disclaimer grants a licence to copy under **CC BY-SA and GFDL**.
We follow CC BY-SA, the simpler of the two:

- **Committing wiki text is allowed**, as long as it stays in its own data directory,
  `ic10-test/data/wiki/`, with its own licence. It's never mixed into code files.
  - `LICENSE`: CC BY-SA, at the version shown in the wiki footer. Version matters: 4.0 is one-way
    compatible with GPLv3, but 3.0 isn't. Keeping the data separately licensed avoids depending on
    that.
  - `ATTRIBUTION.md`, generated by `catalog:build`, lists for each page: page title, URL, revision
    ID, retrieval date, a link to the page history (which credits the authors), and the licence. A
    `Special:Export` file already contains page titles and revision IDs, so this can be automatic.
  - Share-alike: the extracted descriptions file is an adaptation of the wiki text, so it carries
    CC BY-SA too. The harness code that *reads* it stays AGPL. That's an aggregate of separately
    licensed parts, not a merged work.
- **Show attribution in the UI**: hovers and the CLI label wiki text `(Stationeers wiki, CC BY-SA)`.
- **Caveats from the disclaimer:**
  - The wiki can't license material it doesn't own. Some wiki descriptions may be copied from the
    game, which is RocketWerkz text. That's low-risk for descriptive data used for reference, but
    it's a reason not to bulk-commit every page "just because."
  - "Stationeers" is a trademark, so we don't name the harness in a way that implies endorsement.
    Describing it as "for the game Stationeers" is fine.

### Uses
1. **Typed, documented builders.** Generate a `.d.ts` per prefab so this autocompletes, and hovering
   a property shows its description and Read/Write:
   ```ts
   .device("filter", "StructureFiltration", { RatioNitrogenInput: 0.7 })
   ```
   A typo or a property that doesn't exist on that device becomes a **compile error** in the test.
2. **Runtime validation.** When a script reads or writes a property the device doesn't have, or
   writes a read-only one, it's reported with the line number. The emulator already enforces
   permissions; the harness surfaces it clearly.
3. **Static validation, no test needed.** For `lb`/`sb`/`lbn`/`sbn`/`lbs` with a literal
   `HASH("StructureX")`, check that the property exists on that prefab and has the right permission.
   This would have flagged review item 1.4, which reads the vent setting `PressureInternal` where a
   measurement was intended.
4. **A CLI lookup:** `npx ic10-test props StructureFiltration` prints a table of name, R/W and
   description.

---

## 6b. VS Code debugger: step through IC10 while a test runs

VS Code supports custom-language debugging through the **Debug Adapter Protocol (DAP)**. The harness
runs IC10 one line at a time through an `async` step, so pausing before any line is a matter of
awaiting until the debugger says "continue."

### Prior art
[Stationeers-ic/vscode-ic10](https://github.com/Stationeers-ic/vscode-ic10) (GPL-3.0, updated
2026-08) already has a DAP debugger with:
- breakpoints and conditional breakpoints;
- step over, step in and step out;
- one thread per chip;
- variable scopes for Registers, Devices, Aliases, Defines, Stack and Network;
- hover evaluation.

It launches from an `.ic10` file plus a `.ic.json` env file. However, it runs on the npm package, so
it has the same engine gaps (§2): no ticks, real-time `sleep`, and the jump limit. Its debugger would
show different behaviour from what our tests see.

GPL-3.0 code can be combined with AGPL-3.0 (GPLv3 §13), so we can reuse its pieces: the TextMate
grammar, language configuration, and the adapter's request handling. The **engine underneath must be
our harness `World`**, so that debugging and testing behave identically.

### How it hooks into tests
```
VS Code ──DAP──▶ ic10-test debug adapter ──socket──▶ harness inside a Vitest test process
                 (in a small VS Code extension         (scheduler awaits a "debug gate"
                  under ic10-test/vscode/)               before every line when
                                                         IC10_DEBUG is set)
```
- **Launch from a test.** A CodeLens "▶ Debug IC10" appears above each `it(...)`, and there's a
  launch config of `{ "type": "ic10-test", "test": "tests/…/x.test.ts", "name": "pulls in night air" }`.
  The adapter starts Vitest for that one test with `IC10_DEBUG=<port>` and a long timeout. The
  harness connects back, and execution pauses at breakpoints set in the `.ic10` file.
- **Debug both together.** A compound launch config can attach the normal Node debugger to the same
  process, so you can break in the TypeScript test *and* step through the IC10 script.
- **Launch from a scenario.** Point the debugger at an `.ic10` file plus a world definition (TS
  builder module or env JSON) for exploring without a test.

### What you see while paused
| Feature | Details |
|---|---|
| **Registers** | `r15 (Stage) = 1`, with aliases shown next to raw names; `sp` and `ra`. Values are editable (`setVariable`). |
| **Stack** | Entries `0…sp`, with the TOS marked. |
| **Devices** | Grouped by pin (`d0 → vent`), then `db`, then other network devices. Each shows its props, slots, name and reference ID (`$1488`). When a register or stack value matches a device's reference ID, it's labelled with that device (`r1 = 5256 → lathe1`). Hovers show the description and Read/Write from the catalogue (§6). Values are editable mid-pause. |
| **Atmospheres** | Pipes and rooms: pressure, temperature, moles and ratio per gas. |
| **World** | Tick, game time, lines used this tick (out of 128), auto-yield count, sleep state, and pending scheduled events. |
| **Inline values** | Current register and device values drawn next to the source lines, like JS debugging. |

### Controls
- Standard controls: **Step Over** (one line; `jal` treated as a call), **Step Into**, **Step Out**
  (to the `j ra`), and **Continue**.
- Extra harness commands as toolbar buttons or the command palette: **Step Tick** (run to the next
  yield or auto-yield), **Run N Ticks**, and **Run Until Event**.
- **Data breakpoints**: right-click a variable and choose "Break on Value Change", e.g. stop when
  `vent.On` or `Stage` changes.
- **Break on halt**: IC10 errors appear as exception stops, e.g. "Halted: invalid register at line
  58". This is toggled in the Breakpoints panel.
- **Break on auto-yield** (optional): stops when a chip is preempted at 128 lines.
- **Step back (later)**: the harness already snapshots state each tick, so DAP's step-back and
  reverse-continue can rewind a tick.

---

## 7. Phases

| Phase | Work | Done when |
|---|---|---|
| **0 Fork and toolchain** | Fork on GitHub (needs your go-ahead when we get there) and add it as a submodule. Convert to Node 24, npm and Vitest. Run the ESM codemod and convert enums. | The fork's own test suite passes under `npx vitest`. `node -e "import('…/dist/index.js')"` works. |
| **1 Engine fixes** | Suspend signal, `define 0`, `ld`/`sd` by reference ID, errors never escaping `step()`, sandbox and i18n initialisation. | The 38-script sweep is 38/38. A `sleep 5` test advances 10 virtual ticks with no real delay. |
| **2 Harness core** | Workspace layout, engine adapter, World builder, tick scheduler with 128-line auto-yield, budgets, halt-on-error, accessors with aliases, snapshots and history. Scripted events (§5.1) and the debug gate (§6b) start here too, since later phases depend on them. | The VCCR test in §4.4 passes. An infinite `runUntil` fails with a trace in milliseconds. |
| **3 Matchers and reports** | §4.6, including the auto-yield matchers and failure reports. | Failure output is readable without a debugger. |
| **4 Tests for your scripts** | Write failing regression tests for [CODE_REVIEW.md](CODE_REVIEW.md) §1 first, then fix the scripts. Then add behaviour tests for the simpler scripts. | The review bugs are covered and fixed. |
| **5 Catalogue** | §6 sources (game, fork data, Stationpedia export, wiki `Special:Export` import), generated `.d.ts`, CLI lookup, runtime surfacing, static batch-op checks. | Mistyped properties in tests fail to compile, and 1.4-style misuse is flagged. |
| **6 World behaviour** | §5 model library, pipe and room atmospheres, and the Logic Mirror proxy device (§5.4). | An Alaska Cooler test cools a pipe over N ticks through the vent model. |
| **7 VS Code debugger** | §6b. Build the adapter and a small extension in `ic10-test/vscode/`, reusing vscode-ic10's grammar and adapter pieces. Add the CodeLens on tests and the scopes from the table. | Breakpoint in an `.ic10` file, "Debug IC10" on a test, step line by line, and watch registers and `vent.On` change. |
| **8 Later** | Lint rules (unused defines, relative branches landing on labels, double aliasing), the preemption sweep, and extracting `ic10-test/` to its own repo. | — |

**Status (2026-10-08):**
- **Phase 0 is done.** The fork has been converted (CI passes). The root npm workspace uses
  `vitest.config.ts` and resolves the fork's TypeScript sources through a `source` export
  condition, so there's no build step. The first VCCR test and the script sweep are in `tests/`.
  The `ic10-test/` workspace package (`@tasermonkey/ic10-test`) exists, with `createEnv`,
  `readScript` and `findScripts` and its own tests. Phase 2's `sim()` builder builds on
  `createEnv`. Paths specific to this repo are in `tests/support/paths.ts`.
- **Phase 1 is done:** G6, G10, the suspend signal (G1/G2, fork side), G11, and i18n defaulting
  to English. The sweep is 37/38; the one failure is Alaska's real `move stage 0` bug. G5
  (undefined identifiers) stays optional and moves to the Phase 8 lint.
- **Phase 2 is done**, apart from `World.fromEnv(json)`, which moves to Phase 3. `ic10-test/` has:
  - `sim()` with `file:` / `code:` programs, devices by key, and `{ id, name, network }` options.
    IDs come from a deterministic sequence starting at `$1001`.
  - The tick scheduler: 128 lines per tick, then an automatic yield; `countNonInstructionLines`;
    per-chip overrides; `sleep` on a virtual clock.
  - Run controls with `maxTicks` / `maxLinesPerRun` budgets. A failing run reports every chip's state
    and the last 20 lines. An endless `runUntil` on a yielding loop fails in about 0.1 s; a loop with
    no yield hits the line budget after about 3 s, at roughly 3 µs per line.
  - Halt-on-error: strong or critical errors, with the housing's `Error` set to 1, and `failOnHalt`.
  - Register accessors that resolve aliases; snapshots and diffs; `record()`.
  - Scripted events: `at`, `every`, `when`.
  - The debug gate (`sim({ debug })`, `setDefaultDebugGate`).

  Line numbers in the API are **0-based**, like the game's `LineNumber`. The VCCR test is in the §4.4
  style, plus a day-comes test that found G13.
- **Phase 3 is done (2026-10-08).** All twelve §4.6 matchers are in `ic10-test/src/matchers/vitest-setup.ts`, loaded
  through `setupFiles`. Each is backed by a plain `check*` function in `src/matchers/checks.ts`.
  Details settled while building them:
  - `toHaveNoErrors()` counts **warnings and above** by default. That includes reading a property
    the device doesn't have, which the emulator records as a warning without halting.
    `{ severity }` changes the threshold.
  - `toOnlyChange` takes a world with `{ since: snapshot }`, or `world.diff(...)`. It accepts aliases
    and `*`, and ignores a housing's `LineNumber`, which the emulator updates on every line.
  - `toHaveProps` also accepts a chip, meaning its housing (`db`). Asymmetric matchers work.
  - A failure report shows the chip's status and source line, registers with aliases (values that
    are reference IDs are labelled with their device), the stack, the devices on its pins and `db`,
    and its last lines. Auto-yield failures also list where the chip was preempted and in which ticks.
  - `World.fromEnv(env)` takes an object, JSON text or a file path. Devices are keyed by unique
    `name`, otherwise by `$hex` ID, or by `{ testKeysById }`. Chips keep their starting registers and stack.

  The VCCR test now uses the matchers.
- **Phase 4 is in progress.** Regression tests were written first and failed, then the scripts were
  fixed, for 1.1 (Alaska), 1.4 (Cooling Air Mgmt), 1.5 (CoolCleanMarsAir) and 1.6 (Suit MKII
  chatter; the fix also corrects the 1.7 branch offset). The script sweep is now 38/38.
  1.9, 1.10 and the FabControl pair needed console-mod devices (`ModularDevice*`) and
  `StationBatteryNuclear`, which aren't in the emulator's device catalogue, so `sim()` now takes
  **custom devices** (`{ custom: true }`, §4.4). The harness registers their hashes with the
  emulator, which otherwise rejects an unknown hash in `lb` / `sb`. With them (2026-10-09):
  - 1.9 Battery Controller 1 and 1.10 Trader Vert: failing tests first, then the fixes.
  - FabControl: behaviour tests with the real setup chip and devices at its hard-coded IDs. They
    passed as written; swapping the light colours or the button offset in Control makes them fail.
  - Behaviour tests for the Trader Vert buttons and numpad.
  - The rest of review §1, with your decisions:
    - 1.2 Alaska: the defines are now kelvin with °C comments (`MIN_TEMP 290 # 17C`,
      `MAX_TEMP 303 # 30C`), and the code uses them. Behaviour is unchanged; a test pins the thresholds.
    - 1.8 Suit MKI and MKII: failing tests first, then the helmet opens only when the outside pressure
      is between 40 and 150 kPa and the temperature between 280 and 313 K, and closes when that stops
      being true, including during the 5 s wait.
    - 1.11 and 1.12, the mixers: the housing shows `Status` (1 mixing, 0 off, NaN for missing devices)
      in all three mixer scripts, and the N-CO2 mixer's second input is the CO₂ (2/3 N₂, 1/3 CO₂,
      kept). The 1.11 test needed engine gap G14 fixed.
    - Tanks no longer have logic in the current game (a tank just adds volume to its pipe network),
      so the air mixers now read pipe analyzers: "PA Nitrogen", "PA CO2", "PA O2" and
      "PA Breathable Air", alongside the existing "PA N-CO2".
    - 1.3 (Alaska vent modes) still needs an in-game check.

  - Behaviour tests for the short scripts (60 lines or fewer): Mars CO2, Grow Lights, Filter
    Controller MKI, Nitrice Crusher (its chip is in a filtration unit), Cold Night Extraction, the
    five room EControl scripts, Dock Occupied, Weather, Arc Furnace, Food Machine Selector and Larree
    Debug. They describe what the scripts do today, except where a review §2 issue was then fixed
    after a failing test: 2.6 (Arc Furnace switched off mid-smelt) and 2.8 (Food Selector dial past
    the item table). Two small tidies too: Weather's dead `seq` line, and duplicate light pushes in
    the room scripts. They needed engine gaps G15 and G16 fixed, and two harness
    additions: `device.slot(i)` (put items in slots for `ls`) and `device.stackAt(i)` (a device's
    own memory), plus `hash(name)`.
  - Weather's warning light (d1) is a Diode in the test. Only the Diode, the console LEDs and the
    Beacon have `Color` logic; ordinary lights, the Flashing Light included, are paint-only. In the
    game code, `Device.CanLogicRead` allows `Color` only when the prefab's `HasColorState` is set.

  - Behaviour tests for the longer scripts (2026-10-10), so every script in `ic10/` now has a test:
    Trader Horz Input (sharing `trader-input.ts` with Vert), Trading Switch Board, Landing Bay, Sat
    Control, Power Controller Battery, Battery Control and Battery Controller 1 (sharing `power.ts`,
    one `describe*` per feature), MBA Solar Power Controller, Larre Controller (with a small Larre
    model in the test until Phase 6), and the workshop scripts V-IC Hash and V-IC - Furnace, tested
    from the outside. Fixed after failing tests, with your decisions: review 2.2 (Landing Bay counts
    up to `EMPTY_KPA` 1 kPa as empty), 2.4 (the generators follow the charging state on every pass,
    so they start on when the battery is low) and 2.7 (Larre harvests only mature plants and gives
    up after 5 tries). Two Landing Bay bugs that weren't in the review were fixed as well: a startup
    branch that left the stage at 0 when the door was open, and a line that switched GoodVent off
    on every pass. `EXT_KPA` stays a per-world define.
  - Device notes: StructureLogicSwitch2 has no `On`, so the Trading Switch Board's dock switches
    are custom console switches in the test. The emulator's `mod` is a true modulo (−1 mod 360 =
    359), as the wiki says. V-IC - Furnace unpacks iron's maximum pressure as 9921, not 10000,
    because of double rounding in the workshop script's packing; the game should do the same, and
    the test pins 9921.

- **Phase 4 is done (2026-10-10).** The §1 review bugs are covered and fixed, apart from 1.3 (Alaska
  vent modes), which needs an in-game check. Afterwards, also test-first: review 2.5 (Battery
  Control and Battery Controller 1 read only "Base CA") and 2.2 in CoolCleanMarsAir and Alaska
  (`EMPTY_KPA`). Then the rest of §2: 2.10 (Suit MKII stops heating and cooling at the setting),
  and 2.9, which turned out to be missed presses rather than repeated ones. A button press is a
  one-tick pulse, and Printer Control read one fabricator's buttons per tick; it now batch-checks
  the round buttons every tick and scans them all on a press. 2.1 is left as is: the only jump of
  5 or more lines is in Suit MKII, which is over the line limit. All of review §2 is dealt with.
  Next is Phase 5, the catalogue (§6).

- **Phase 5 is in progress (2026-10-10).** Decisions: the generated catalogue is gitignored and
  built before `npm test` and `npm run typecheck`; mods' devices get their properties from the
  Stationpedia export (or the mod's DLL if the export leaves them out), committed to `data/mods/`;
  the wiki import is deferred. Steps: 1 `catalog:build`, 2 typed builder, 3 static batch-op check,
  4 CLI, 5 runtime messages.
  - Step 1 is done: `catalog:build` writes `ic10-test/generated/catalog.json` from the fork's 407
    prefabs and the game's `english.xml`. ic10emu's descriptions were tried as a fallback and
    dropped, since they come from the same export.
  - The Stationpedia export (game 0.2.6428.27798) includes mods' devices. `npm run
    catalog:import-stationpedia` wrote the 130 prefabs with logic that the fork's data lacks (all 56
    console parts, `StationBatteryNuclear`, Mirrored Devices, FPGA, terminals, circuit breakers) to
    committed `ic10-test/data/mods/prefabs.json`, so the DLL isn't needed. `catalog:build` now has
    537 prefabs and takes descriptions from the export's `Enums.json`, then `english.xml`; all 366
    logic types are described. The export also shows 10 game prefabs with extra logic types the
    fork's data lacks (batteries: `ImportQuantity`, `ExportQuantity`; transformers: `PowerActual`),
    from a newer game version or a power mod. The catalogue keeps the fork's for now.

Suggested first regression tests (Phase 4):

| Review item | Test |
|---|---|
| 1.1 Alaska `stage` | Run until cooling finishes, then `toHaveNoErrors()`. Today it halts at line 57 (0-based; editor line 58). |
| 1.4 Cooling Air Mgmt | Hot pipe at 5,000 kPa, then the vent is on. |
| 1.5 CoolCleanMarsAir | Input below setpoint, then `db.Mode` returns to 0. |
| 1.6 Suit MKII chatter | O₂ low and pressure normal for 20 ticks, then `toToggleAtMost(2)` on Filtration. |
| 1.9 Battery Controller 1 | Battery 0% with generation, then the gauge isn't 0. Zero generation, then no `NaN`. |
| 1.10 Trader Vert | After the first tick, the HC display is unchanged. |
| FabControl pair | Setup writes IDs into Control's stack, Control drives the right fabricator by `ld`/`sd`, and a power switch set to off turns the light red and skips that fabricator. |

---

## 8. Licensing notes
- The fork stays **AGPL-3.0**. Keep its LICENSE, and mark modified files with change notices (§5a).
- `ic10-test/` imports the fork, so if it's distributed it should be AGPL-3.0 too. Give the
  subdirectory its own LICENSE file when it's created.
- **Your IC10 scripts** are input to the emulator, not linked code, so they can carry any licence.
  The repo has no LICENSE at the moment, which means "all rights reserved" by default.
- Generated catalogue text from `english.xml` is RocketWerkz's. Keep it out of git (§6).
- Wiki text is CC BY-SA and GFDL. It may be committed in its own data directory with a CC BY-SA
  `LICENSE` and a generated `ATTRIBUTION.md` (§6). It is never mixed into AGPL code files.

---

## Appendix: spike notes (2026-10-07)
- `Builder.from(env)` → for each runner, `switchContext("real")` and `init()` → `runner.step()` loop.
  This works with the npm package's CJS build under Node 24. The ESM build fails because of
  extensionless imports.
- Env `props` can set read-only values such as `TemperatureOutput`, which tests need for sensor
  inputs.
- `housing.props.read("Setting")` reads `db` writes. `chip.registers.get(i)` reads registers.
  `chip.defines` holds aliases, defines, labels and built-in constants.
- `alias Stage r15` / `move stage 0` gives a strong `invalid_argument_register` error, but execution
  continues (G4).
- About 3,000 lines run in about 12 ms, so performance isn't a concern.
- Reference IDs: env devices take an `id`, and `put d0 …` / `get … d0 …` into another chip's stack
  works. `ld`/`sd` fail in every form (G10), and the exception escapes `step()` (G11).
  `l r3 r1 On` (a register used as a device) gives `invalid_argument_device_pin`, which is correct;
  that form needs `ld`.
- The spike scripts are in this session's scratchpad, not the repo. Phase 0 recreates them as real
  tests.
