/**
 * Type-level checks for `sim()` against generated/prefab-props.ts. Not run: `npm run typecheck`
 * fails if a line marked @ts-expect-error stops being an error, or an unmarked line becomes one.
 */
import { type PropsOf, sim } from "../src/index.ts";

sim().device("vent", "StructureActiveVent", { Mode: 1, On: 1, PressureExternal: 50 });
// @ts-expect-error A misspelt property.
sim().device("vent", "StructureActiveVent", { Mdoe: 1 });
// @ts-expect-error A misspelt prefab.
sim().device("vent", "StructureActivVent", { Mode: 1 });

// Mods' devices are typed from data/mods/.
sim().device("button", "ModularDeviceRoundButton", { Activate: 1, Color: 2 });
// @ts-expect-error A round button has no Ratio.
sim().device("button", "ModularDeviceRoundButton", { Ratio: 2 });

// A housing's own properties follow its prefab (StructureCircuitHousing by default).
sim().housing("ic", { code: "", props: { Setting: 1 } });
sim().housing("ac", { code: "", prefab: "StructureAirConditioner", props: { TemperatureInput: 300 } });
// @ts-expect-error A circuit housing has no TemperatureInput.
sim().housing("ic", { code: "", props: { TemperatureInput: 300 } });

// Anything goes for a custom device.
sim().device("widget", "ModFutureWidget", { Anything: 1 }, { custom: true });
// @ts-expect-error An unknown prefab needs custom: true.
sim().device("widget", "ModFutureWidget", { Anything: 1 });

const ventProps: PropsOf<"StructureActiveVent"> = { Mode: 0 };
void ventProps;
