# IC10 Bench for VS Code

Step through your Stationeers IC10 scripts line by line while the
[`@tasermonkey/ic10-bench`](../ic10-test/) tests run. Set a breakpoint in a `.ic10` file, start the
test, and you can see every register, the stack and every device, change values, and step a line or
a game tick at a time.

## Install

It isn't on the Marketplace yet. From the workspace root (after `npm install`), build it and install
it:

```
npm run vscode:package -w ic10-test-vscode
code --install-extension ic10-test-vscode/dist/ic10-bench.vsix --force
```

Then run **Developer: Reload Window**. You'll need:
- Node.js 24 or later on your `PATH`;
- an IC10 language extension for syntax highlighting (this one adds breakpoints to `.ic10` files but
  doesn't colour them).

## Debugging a test

1. Open your `.ic10` script and click in the margin to set a breakpoint.
2. Open the test that runs it and click **▶ Debug IC10** above the `it(...)` (or above a `describe`
   to run the group).
3. The test stops at your breakpoint. From there:
   - **F10 / F11 / Shift+F11** step over, into (a `jal`) and out of a subroutine;
   - **Variables** shows the chip's registers (with their aliases), stack, devices, pipes and rooms,
     and the game tick. Double-click a register, stack entry or device property to change it;
   - hover over a register or `d0.On` to see its value, or add it to **Watch**;
   - each chip is a thread in **Call Stack**, so you can switch between them.

Other ways to start: **F5** with the test file open, or **IC10 Bench: Debug IC10 in the Test at the
Cursor** from the command palette.

The debugger also stops when a chip halts on an error, showing why. Under **Breakpoints**, tick
**Automatic yields** to also stop when a chip runs out of its 128 lines in a tick.

## Running by game ticks

While stopped, the debug toolbar has three more buttons. Each goes by the chip selected in Call
Stack:

- **Step Tick** runs to the chip's next turn, past its `yield` or `sleep`. Other chips run as usual.
- **Run N Ticks…** runs that many ticks, then stops.
- **Run Until Event…** runs until one of the test's scheduled events (`world.at`, `every`, `when`)
  happens.

## Breakpoints that do more

- **Conditions.** Right-click a breakpoint, **Edit Condition**, and enter something like
  `Counter == 5` or `d0.Temperature > 300`.
- **Logpoints.** Instead of stopping, print a message: `count {Counter}`. It shows in the Debug
  Console.
- **Break on a value changing.** Right-click a value in Variables (a register, a stack entry, a
  device property) or Watch, and choose **Break on Value Change**. The debugger stops right after the
  line that changed it, or names the scripted event if something outside the chip did.

While stopped, each line above the one you're on shows the values it uses at its end (`Stage = 2`,
`Vent.On = 1`). They're the values now, not when the line ran. Turn them off with VS Code's
`debug.inlineValues` setting.

## Exploring without a test

Sometimes you just want to watch a script run in a setup. Write a **scenario**: a file named
`x.world.ts` whose default export builds and returns a world.

```ts
// greenhouse.world.ts
import { sim } from "@tasermonkey/ic10-bench";

export default async () => {
	const world = await sim({ root: import.meta.dirname })
		.device("sensor", "StructureGasSensor", { Temperature: 290 })
		.housing("ic", { file: "greenhouse.ic10", pins: { d0: "sensor" } })
		.build();
	world.every({ ticks: 60 }, (w) => w.device("sensor").add("Temperature", -40), { label: "nightfall" });
	return world;
};
```

Open it, or the `greenhouse.ic10` beside it, and click **Debug IC10 Scenario** in the editor title
(or press F5). An emulator env JSON (`x.env.json` with `program` naming the script) works too.

A scenario runs as fast as it can, so **set a breakpoint first** or it may just run to the end. It
stops on its own once every chip has stopped and no events are left.

## Debugging the TypeScript too

If you also want to stop in the test's own code (a model, an event, an expectation), turn on the
setting **IC10 Bench: Debug TypeScript**. Breakpoints in `.ts` files then stop as well, in a second
session under the IC10 one in Call Stack. While the TypeScript is stopped, the IC10 side shows as
running. Stopping either session ends both.

## Try it

[`examples/`](examples/) has one small test and script for each feature, with what to try written
at the top of each script.

## Launch configurations

You don't need a `launch.json`, but you can add one to save a setup:

```jsonc
{
	"type": "ic10-bench",
	"request": "launch",
	"name": "Debug a test",
	"test": "${workspaceFolder}/tests/MyBase/airlock.test.ts",
	"line": 27,                  // the it(...) to run; the whole file if left out
	"stopOnEntry": false,
	"debugTypeScript": false
}
```

```jsonc
{
	"type": "ic10-bench",
	"request": "launch",
	"name": "Debug the scenario in the current file",
	"scenario": "${file}",       // a world module, env JSON, or an .ic10 with one beside it
	"program": "x.ic10",         // env JSON only: the script a chip runs
	"chip": "housing"            // env JSON only: which chip runs it, if there's more than one
}
```

Also available: `cwd` (where Vitest's config is; found from the test if left out),
`runtimeExecutable` (`node` by default), `args` (more arguments for `vitest run`) and `env`.

## Settings

| Setting | Default | |
|---|---|---|
| `ic10-bench.codeLens` | `true` | Show **▶ Debug IC10** above tests. |
| `ic10-bench.debugTypeScript` | `false` | Debug the test's TypeScript as well. |

## Licence

AGPL-3.0-or-later (`LICENSE`). The bundle includes `@vscode/debugadapter` (MIT); its notice is in
`THIRD_PARTY_NOTICES.md`.

Working on the extension itself? See [CONTRIBUTING.md](CONTRIBUTING.md).
