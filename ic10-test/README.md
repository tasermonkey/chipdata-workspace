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

expect(world.device("vent").props("Mode", "On")).toEqual({ Mode: 0, On: 1 });
expect(world.chip("ic").reg("OutsideTemp")).toBe(450); // aliases work
expect(world.chip("ic").halted).toBe(false);
```

## Execution model

- **Ticks.** Each tick (0.5 s of game time by default), every chip in declaration order runs until it
  `yield`s, `sleep`s, halts, ends, or has run 128 lines (an automatic yield). Blank, comment and label
  lines count toward the 128, as in game; `countNonInstructionLines: false` changes that.
- **Sleep** parks a chip until game time reaches its wake time; nothing waits in real time.
  `sleep 0` acts as a `yield`.
- **Errors halt the chip**, as in game: strong and critical errors stop it and set the housing's
  `Error` to 1. A halt is state to assert on (`chip.halted`, `chip.halt`), not a failure, unless
  the world is built with `failOnHalt: true`.
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

- `world.device(key)`: `get`, `set` (read-only properties too), `add`, `props(...)`, `id`, `idHex`, `name`.
- `world.chip(key)`: `reg("Stage" | "r15")`, `setReg`, `registers()`, `aliases()`, `stack()`, `stackAt(i)`,
  `sp`, `ra`, `line`, `errors`, `halt`, `ended`, `sleeping`, `autoYields`, `db`.
- `world.network(id).byName(...)` / `.byType(...)`.
- `world.snapshot()` / `world.diff(before)`; `world.record("vent.On")` samples a value every tick.

## Debugging

`sim({ debug: gate })` (or `setDefaultDebugGate(gate)`) installs hooks the scheduler awaits before every
line, on halts, on automatic yields and after each tick. The VS Code debugger will attach through this.

Also exported: `createEnv` (a lower-level world from emulator env JSON), `readScript` / `findScripts`,
`parseId` / `formatId`.

Runs as TypeScript source on Node 24+ (no build step yet).
