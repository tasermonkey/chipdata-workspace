# ic10-test-vscode

A VS Code debugger for Stationeers IC10 scripts that steps through them while their
[`@tasermonkey/ic10-test`](../ic10-test/) tests run. It's a sibling of the harness rather than part of
it, so the two can become separate packages later. The only thing it takes from the harness is the
debug protocol's types and version (`@tasermonkey/ic10-test/debug-protocol`).

## How it works

```
VS Code ──DAP──▶ adapter (src/adapter.ts) ──spawns──▶ node vitest.mjs run <test>:<line> --testTimeout=0
                     ▲                                  with IC10_DEBUG=<port>
                     └──── newline-delimited JSON ◀──── the harness's debug agent connects back
```

The adapter keeps no IC10 state of its own. It forwards breakpoints and exception filters to the
test's agent, and passes on the agent's threads (one per chip), stops, variables and output. The
agent decides where to stop, in the test process. Vitest runs in the folder of the nearest
`vitest.config.*` above the test. Its output goes to the Debug Console.

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
	"env": {}
}
```

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

## Status

Done so far (Phase 7 steps 5–8 of `TEST_FRAMEWORK_PLAN.md`):
- the adapter;
- the extension, installed as a local `.vsix`;
- the **▶ Debug IC10** CodeLens above each test (turn it off with the `ic10-test.codeLens`
  setting);
- the tick commands.

Data breakpoints and inline values come next.

## Tests

`test/adapter.test.ts` drives the adapter with `@vscode/debugadapter-testsupport`'s `DebugClient`
against real Vitest runs of `test/fixtures/chips.debug.ts`. No editor is needed. They run with the
workspace's `npm test`.
