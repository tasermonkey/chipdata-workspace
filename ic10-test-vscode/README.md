# ic10-test-vscode

A VS Code debugger for Stationeers IC10 scripts that steps through them while their
[`@tasermonkey/ic10-test`](../ic10-test/) tests run. It's a sibling of the harness rather than part of
it, so the two can become separate packages later. The only thing it takes from the harness is the
debug protocol's types and version (`@tasermonkey/ic10-test/debug-protocol`).

## Install

It isn't on the Marketplace. Build the `.vsix` from the workspace root and install it:

```
npm run vscode:package -w ic10-test-vscode
code --install-extension ic10-test-vscode/dist/ic10-test-vscode.vsix --force
```

Then **Developer: Reload Window**. It needs Node 24+ on the `PATH` and an IC10 language extension for
highlighting (it declares the `ic10` language and its breakpoints, but has no grammar). It shows itself
only in a workspace with an `.ic10` file or `@tasermonkey/ic10-test` installed.

To run it from source instead, use the launch configuration "Run the IC10 Test extension" in this
workspace's `.vscode/launch.json`.

## How it works

```
VS Code ──DAP──▶ adapter (src/adapter.ts) ──spawns──▶ node vitest.mjs run <test>:<line> --testTimeout=0
                     ▲                            or  node --conditions=source run-scenario.ts <scenario>
                     │                                  with IC10_DEBUG=<port>
                     └──── newline-delimited JSON ◀──── the harness's debug agent connects back
```

The adapter keeps no IC10 state of its own. It forwards breakpoints and exception filters to the
test's agent, and passes on the agent's threads (one per chip), stops, variables and output. The
agent decides where to stop, in the test process. Vitest runs in the folder of the nearest
`vitest.config.*` above the test. Its output goes to the Debug Console.

## Starting it

- **▶ Debug IC10** above each `it`, `test` and `describe` runs that test or group (the setting
  `ic10-test.codeLens` turns the lenses off).
- **IC10 Test: Debug IC10 in the Test at the Cursor** in the command palette does the same.
- **F5** with no launch.json debugs the test file or scenario in the editor.
- A **launch configuration** (below).
- For a scenario, the **Debug IC10 Scenario** button in the editor title.

## Launch configuration

```jsonc
{
	"type": "ic10-test",
	"request": "launch",
	"name": "Debug a test",
	"test": "${workspaceFolder}/tests/ClimateControl/VCCR Cooling Air Management.test.ts",
	"line": 27,              // the it(...) to run; the whole file if left out
	"stopOnEntry": false,
	"cwd": "${workspaceFolder}",   // where Vitest's config is; found from the test if left out
	"runtimeExecutable": "node",   // Node 24+
	"args": [],                    // more arguments for `vitest run`
	"env": {},
	"debugTypeScript": false       // the setting ic10-test.debugTypeScript if left out
}
```

Or a scenario in place of `test` (see [Scenarios](#scenarios-a-world-without-a-test)):

```jsonc
{
	"type": "ic10-test",
	"request": "launch",
	"name": "Debug the scenario in the current file",
	"scenario": "${file}",   // a world module, env JSON, or an .ic10 that has one beside it
	"program": "x.ic10",     // env JSON only: the script a chip runs (found for an .ic10)
	"chip": "housing"        // env JSON only: which chip runs it, if there's more than one
}
```

With no launch.json, F5 debugs the test file or scenario in the editor.

Exception breakpoints: **Halts** (on by default) stop when a chip halts on an error; **Automatic
yields** stop when a chip uses up its 128 lines in a tick.

## Tick commands

While stopped, the debug toolbar (and the command palette, under **IC10 Test**) has three more
ways to run on. Each goes by the chip focused in the Call Stack:

- **Step Tick** runs to the chip's first instruction in its next turn, past its `yield`, `sleep` or
  automatic yield. The other chips run as usual.
- **Run N Ticks…** stops between ticks once that many have finished (the tick in progress counts).
- **Run Until Event…** stops just after a scripted event (`world.at`, `every`, `when`) runs: one
  you pick from those to come, or any.

## Trying it out

[`examples/`](examples/) has one small test and script per feature, with what to try written at the top
of each script.

## Data breakpoints

Right-click a value in Variables (a register, a stack entry, a device's property, a pipe or room
reading) or an expression in Watch, and choose **Break on Value Change**. The debugger stops when the
value changes:
- after the line that changed it, naming that line. The chip is shown at its next line, and
  carrying on runs that line without stopping at it again;
- or, when something outside the chips changed it (a scripted event, a model, a pipe or room
  reading, the test), before the next line, naming the event if there was one.

Data breakpoints take conditions, and they're kept for the next run of the same test.

## Inline values

While stopped, each line of the script up to the one stopped at shows, at its end:
- the registers and register aliases it uses, and the device property an `l` or `s` reads or writes
  (`Stage = 2`, `Vent.On = 1`);
- for `put`, `get` and `poke`, the entry they address (`stack[10] = 3`, `Ctl.stack[0] = 5`);
- on the line stopped at only: where a `push` writes and what it overwrites (`push → stack[2],
  overwriting 7`), or what a `pop` or `peek` reads (`pop ← stack[1] = 8`). On lines above, `sp` has
  moved on, so these would point at the wrong entry.

They're the values now, not when the line last ran. VS Code's `debug.inlineValues` setting turns them
off.

## Debugging the TypeScript too

Set `"debugTypeScript": true` in a launch configuration, or turn on the setting **IC10 Test: Debug
TypeScript** (`ic10-test.debugTypeScript`) for the CodeLens, the cursor command, F5 and any configuration
that doesn't say. The test then runs under VS Code's JavaScript debugger as well, so breakpoints in the
test's TypeScript (a model, an event, an expectation) stop too. The JavaScript session shows under the
IC10 one in the Call Stack, and stopping either ends both.

While a TypeScript breakpoint holds the test, the IC10 side can't answer: it shows as running, and an
IC10 Pause takes effect once the TypeScript carries on.

## Scenarios: a world without a test

A scenario is a world to explore, with no test around it:
- a **world module** (`x.world.ts`), whose default export builds the world and returns it, with any
  events and models;
- or **env JSON** (`x.env.json`), with `program` naming the `.ic10` one of its chips runs.

An `.ic10` stands for the world module beside it (`x.world.ts`), or failing that the env JSON
(`x.env.json`, `x.json`) with the script as its program. On any of these files the **Debug IC10
Scenario** button in the editor title starts it, as does F5 with no launch.json.

It runs under plain Node (`@tasermonkey/ic10-test/run-scenario`), so it starts in about half a second,
and runs ticks as fast as it can. **Set a breakpoint first**, or it may simply run to its end. It ends
once every chip has stopped and no scripted events are due, saying so in the Debug Console. Debugging the
TypeScript too works here as well.

## Tests

`test/adapter.test.ts` drives the adapter with `@vscode/debugadapter-testsupport`'s `DebugClient`
against real Vitest runs of the fixtures in `test/fixtures/`, and real scenario runs. No editor is
needed. What does need VS Code (the extension's commands, CodeLens and buttons, and the JavaScript
debugger) is checked by hand with [`examples/`](examples/). They all run with the workspace's
`npm test`.

## Licence

AGPL-3.0-or-later (`LICENSE`). The bundle includes `@vscode/debugadapter` (MIT); its notice is in
`THIRD_PARTY_NOTICES.md`.
