# Working on the IC10 Bench extension

Notes for changing the extension itself. To use it, see the [README](README.md).

It's a sibling of the harness rather than part of it, so the two can become separate packages later.
The only thing it takes from the harness is the debug protocol's types and version
(`@tasermonkey/ic10-bench/debug-protocol`).

## Running from source

Use the launch configuration "Run the IC10 Bench extension" in the workspace's `.vscode/launch.json`.
To build and install the `.vsix`, see the README.

## How it works

```
VS Code ──DAP──▶ adapter (src/adapter.ts) ──spawns──▶ node vitest.mjs run <test>:<line> --testTimeout=0
                     ▲                            or  node run-scenario.js <scenario>
                     │                                  with IC10_DEBUG=<port>
                     └──── newline-delimited JSON ◀──── the harness's debug agent connects back
```

The adapter keeps no IC10 state of its own. It forwards breakpoints and exception filters to the
test's agent, and passes on the agent's threads (one per chip), stops, variables and output. The
agent decides where to stop, in the test process (see the harness's
[CONTRIBUTING.md](../ic10-test/CONTRIBUTING.md#how-the-debugger-attaches)). Vitest runs in the
folder of the nearest `vitest.config.*` above the test. Its output goes to the Debug Console.

Scenarios run under plain Node (`@tasermonkey/ic10-bench/run-scenario`), so they start in about half
a second. `findHarnessFile` picks the file from the harness's `exports`: the compiled `.js` from an
install, or, when the harness is a linked checkout (outside `node_modules`), its TypeScript source
with `--conditions=source`.

## Other IC10 extensions

The extension declares the language `ic10` for `.ic10` files, with no grammar, only so breakpoints
and inline values attach to them. The IC10 syntax extensions people already use declare the same
id: Traineratwot.stationeers-ic10 (the emulator's authors'), shaneyu.stationeers,
AshleyWilliamson.ic10-language-support and FlorpyDorp's (checked October 2026). VS Code merges
contributions to one id, so their highlighting and this extension's breakpoints work together.
An extension that used another id for `.ic10` would take the files from this one; if one appears,
add its id to `contributes.breakpoints` and to the inline-values selector in `extension.ts`.

## Tests

`test/adapter.test.ts` drives the adapter with `@vscode/debugadapter-testsupport`'s `DebugClient`
against real Vitest runs of the fixtures in `test/fixtures/`, and real scenario runs. No editor is
needed. What does need VS Code (the extension's commands, CodeLens and buttons, and the JavaScript
debugger) is checked by hand with [`examples/`](examples/). They all run with the workspace's
`npm test`.
