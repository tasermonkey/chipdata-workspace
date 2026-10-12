# Working on ic10-test-vscode

Notes for changing the extension itself. To use it, see the [README](README.md).

It's a sibling of the harness rather than part of it, so the two can become separate packages later.
The only thing it takes from the harness is the debug protocol's types and version
(`@tasermonkey/ic10-test/debug-protocol`).

## Running from source

Use the launch configuration "Run the IC10 Test extension" in the workspace's `.vscode/launch.json`.
To build and install the `.vsix`, see the README.

## How it works

```
VS Code ──DAP──▶ adapter (src/adapter.ts) ──spawns──▶ node vitest.mjs run <test>:<line> --testTimeout=0
                     ▲                            or  node --conditions=source run-scenario.ts <scenario>
                     │                                  with IC10_DEBUG=<port>
                     └──── newline-delimited JSON ◀──── the harness's debug agent connects back
```

The adapter keeps no IC10 state of its own. It forwards breakpoints and exception filters to the
test's agent, and passes on the agent's threads (one per chip), stops, variables and output. The
agent decides where to stop, in the test process (see the harness's
[CONTRIBUTING.md](../ic10-test/CONTRIBUTING.md#how-the-debugger-attaches)). Vitest runs in the
folder of the nearest `vitest.config.*` above the test. Its output goes to the Debug Console.

Scenarios run under plain Node (`@tasermonkey/ic10-test/run-scenario`), so they start in about half
a second.

## Tests

`test/adapter.test.ts` drives the adapter with `@vscode/debugadapter-testsupport`'s `DebugClient`
against real Vitest runs of the fixtures in `test/fixtures/`, and real scenario runs. No editor is
needed. What does need VS Code (the extension's commands, CodeLens and buttons, and the JavaScript
debugger) is checked by hand with [`examples/`](examples/). They all run with the workspace's
`npm test`.
