# Debugger playground

One small test per debugger feature, each with its own `.ic10` script. The comments at the top of each
script say what to try. Open the script, set the breakpoint it suggests, then click **▶ Debug IC10**
above the test in the matching `.test.ts`. These tests also run in the workspace's `npm test`, so they
keep working.

| Feature | Test | Script | Try |
|---|---|---|---|
| Breakpoints, conditions, logpoints | `breakpoints.test.ts` | `breakpoints.ic10` | A breakpoint on `add`; the condition `Counter == 5`; a logpoint `count {Counter}` |
| Step Over / Into / Out, Call Stack | `stepping.test.ts` | `stepping.ic10` | Breakpoint on `jal outer`; F10, F11, Shift+F11; the recursive `countdown` |
| Variables, editing, hover, Watch, Debug Console | `variables.test.ts` | `variables.ic10` | Breakpoint on `yield`; every scope; set `Stage` to `Max`; watch `vent.On` |
| Halts and automatic yields | `exceptions.test.ts` | `halts.ic10`, `auto-yields.ic10` | No breakpoint needed for the halt; tick **Automatic yields** under Breakpoints for the other |
| Several chips, inline code | `chips.test.ts` | `chips.ic10` (plus inline `setup`) | Breakpoint on `add`; switch threads; open the inline chip's source |
| Step Tick, Run N Ticks, Run Until Event | `ticks.test.ts` | `ticks.ic10` | Breakpoint on `move Phase 1`; the toolbar's watch, run-all and bell buttons |

Data breakpoints, inline values, debugging the TypeScript too, and launching from a scenario (Phase 7
steps 9–12) will each add an example here.
