# IC10 Code Review

A review of the scripts under [ic10/](ic10/). Findings are grouped by severity first, then general
suggestions that apply across scripts, then a short per-folder list of smaller items.

Scripts that came from the Steam Workshop or elsewhere (the gas mixer scripts, the Advanced Furnace
scripts, and the Solar Power Controller) were only skimmed. Where an issue is in code you added or
changed in them, it is called out.

Line numbers refer to the files as committed at `f71665a`.

> **Caveat:** I haven't run any of this in game. Anything that depends on in-game behaviour (vent
> modes, sorter instruction format, which values are settings and which are readings) is marked
> *verify in game*.

---

## 1. Likely bugs

These are places where the code almost certainly doesn't do what the comments or README say.

**Status (2026-10-09).** Each fix was made after a test that failed against the script as it was
(1.2's test pins behaviour that didn't change). Line numbers in the items below are from before
the fixes.

| Item | Status | Test |
|---|---|---|
| 1.1 Alaska `stage` | Fixed 2026-10-08 | [Alaska IC Cooler.test.ts](tests/ClimateControl/Alaska%20IC%20Cooler.test.ts) |
| 1.2 Alaska `MIN_TEMP` / `MAX_TEMP` | Fixed: kelvin defines with °C comments, now used | same |
| 1.3 Alaska vent modes | **Open**: needs an in-game check | — |
| 1.4 Cooling Air Management | Fixed 2026-10-08 | [VC-IC Cooling Air Management.test.ts](tests/ClimateControl/VC-IC%20Cooling%20Air%20Management.test.ts) |
| 1.5 CoolCleanMarsAir | Fixed 2026-10-08 | [CoolCleanMarsAir.test.ts](tests/ClimateControl/CoolCleanMarsAir.test.ts) |
| 1.6 Suit MKII filtration chatter | Fixed 2026-10-08 | [Simple Suit Controller MKII.test.ts](tests/SuitControl/Simple%20Suit%20Controller%20MKII.test.ts) |
| 1.7 Suit MKII branch offset | Fixed by the 1.6 change | same |
| 1.8 Suit helmet in a hostile atmosphere | Fixed (MKI and MKII): 40–150 kPa and 280–313 K | [helmet.ts](tests/SuitControl/helmet.ts), run by both suit tests |
| 1.9 Battery Controller 1 guard | Fixed | [VCIC - Battery Controller 1.test.ts](tests/EControl/VCIC%20-%20Battery%20Controller%201.test.ts) |
| 1.10 Trader Vert reset | Fixed | [VCIC Trader Vert Input.test.ts](tests/TraderControl/VCIC%20Trader%20Vert%20Input.test.ts) |
| 1.11 Mixer housing status | Fixed in all three mixer scripts | [gas-mixer.ts](tests/support/gas-mixer.ts), run by each mixer's test |
| 1.12 N-CO2 "O2 Tank" | Fixed: the second input is the CO₂. Tanks no longer have logic in game, so both air mixers now read pipe analyzers (`PA Nitrogen`, `PA CO2`, `PA O2`, `PA Breathable Air`) | [MBA - N-CO2 Mixer.test.ts](tests/ClimateControl/AirMixers/MBA%20-%20N-CO2%20Mixer.test.ts) |

### 1.1 Alaska IC Cooler: misspelled register alias errors the chip
[Alaska IC Cooler [101290].ic10:58](ic10/ClimateControl/Alaska%20IC%20Cooler%20%5B101290%5D.ic10#L58)

```
finishCooling:
move stage 0      # alias is "Stage" (capital S)
```

IC10 aliases are case sensitive. `stage` is undefined, so the chip will error the first time cooling
finishes. It should be `move Stage 0`.

### 1.2 Alaska IC Cooler: `MIN_TEMP` / `MAX_TEMP` are unused, and the hard-coded values don't match them
[Alaska IC Cooler [101290].ic10:16-17, 47, 51](ic10/ClimateControl/Alaska%20IC%20Cooler%20%5B101290%5D.ic10#L16)

The defines are `19` and `28`, which look like °C. The code actually compares against `303` K (30 °C)
and `290` K (17 °C). Pick one range, write it in Kelvin, and use the defines:

```
define MIN_TEMP 290 # 17C
define MAX_TEMP 303 # 30C
...
blt r0 MAX_TEMP start
...
blt r0 MIN_TEMP finishCooling
```

### 1.3 Alaska IC Cooler: vent modes look swapped *(verify in game)*
[Alaska IC Cooler [101290].ic10:32, 52](ic10/ClimateControl/Alaska%20IC%20Cooler%20%5B101290%5D.ic10#L32)

On an Active Vent, `Mode 0` is Outward (pipe → room) and `Mode 1` is Inward (room → pipe). The
`VCCR Cooling Air Management` script follows that convention: night mode uses `Mode 1` to pull cold
air in. This script does the opposite:

- `stopCooling` turns on Inward (`Mode 1`) and waits for `PA_ATMO` pressure to reach **0**. Pulling
  air *in* only raises that pressure, so this stage would never finish.
- `startCooling` uses Outward (`Mode 0`) to "bring in cold air."

If the comments describe what you wanted, the two modes should be swapped. Together with 1.1, this
suggests the script never ran a full cycle in its current form.

### 1.4 Cooling Air Management [498974]: reads a setting instead of a measurement, and the pressure test is inverted
[VC-IC Cooling Air Management [498974].ic10:12-15](ic10/ClimateControl/VC-IC%20Cooling%20Air%20Management%20%5B498974%5D.ic10#L12)

```
l r1 ExpelGasExchangeVent PressureInternal   # this is the vent's *limit setting*, not the pipe pressure
sgt r2 r0 MAX_PIPE_TEMP
slt r3 r1 MIN_PRESSURE                       # "expel only when pressure is LOW"
min r2 r2 r3
```

- `PressureInternal` on an active vent is the configured limit (you write it as a setting in
  `CoolCleanMarsAir`). The pipe's actual pressure is `PressureOutput`, which the other cooling
  scripts read.
- The test says "expel while pressure is *below* 500." You almost certainly want to keep at least
  500 kPa in the pipe, so expel while pressure is *above* it (`sgt`).

The simplest fix is to let the vent enforce the floor itself:

```
s ExpelGasExchangeVent PressureInternal MIN_PRESSURE   # vent stops when pipe drops to this
sgt r2 r0 MAX_PIPE_TEMP
s ExpelGasExchangeVent Mode 0
s ExpelGasExchangeVent On r2
```

### 1.5 CoolCleanMarsAir: once cooling starts, it never stops
[CoolCleanMarsAir [7335].ic10:72-76](ic10/ClimateControl/CoolCleanMarsAir%20%5B7335%5D.ic10#L72)

```
coolingInp:
l r1 db TemperatureInput
sne r2 r1 DesiredTempK     # on whenever temp != setpoint
s db Mode r2
```

A floating-point temperature will practically never equal `DesiredTempK` exactly, so the AC stays on.
Nothing sets `GasCoolingStage` back to 0, so the "wait for warm" hysteresis only runs once. Suggested
fix:

```
coolingInp:
l r1 db TemperatureInput
sgt r2 r1 DesiredTempK
s db Mode r2
bnez r2 ra
move GasCoolingStage 0     # reached target, go back to waiting
j ra
```

`waitForWarmInp` could also use `DesiredTempK + some delta` as its threshold so the band is wider
than one tick of noise.

### 1.6 Simple Suit Controller MKII: filtration flips on and off every tick
[Simple SUit Controller MKII.ic10:92-110](ic10/SuitControl/Simple%20SUit%20Controller%20MKII.ic10#L92)

- `filtrationOff` turns filtration **on** when the O₂ partial pressure drops below 30 kPa.
- `filtrationOn` turns it **off** when the *total* helmet pressure is ≥ 80% of the suit's pressure
  setting.

These test different quantities. If O₂ is low but total pressure is normal, which is the usual case
when CO₂ is building up, the code alternates on, off, on, off every tick. Use the same quantity for
both edges, with a gap between the thresholds:

```
define O2PartialPressureMinKpa 30
define O2PartialPressureOkKpa  40
```

### 1.7 Simple Suit Controller MKII: wrong relative branch offset
[Simple SUit Controller MKII.ic10:108](ic10/SuitControl/Simple%20SUit%20Controller%20MKII.ic10#L108)

```
brlt r0 r1 4      # skips past "j ra", lands on airToggle: and runs it
move rFiltrationState filtrationOff
j ra
                  # blank
airToggle:
```

This was meant to skip one instruction (`2`). With `4` it lands on the `airToggle:` label and runs
`airToggle` as part of this call. That's harmless today because `airToggle` runs again right after,
but this is the kind of bug relative branches cause (see §2.1).

### 1.8 Simple Suit Controller (MKI & MKII): can open the helmet in a hostile atmosphere
[Simple SUit Controller MKII.ic10:51-60](ic10/SuitControl/Simple%20SUit%20Controller%20MKII.ic10#L51),
[Simple Suit Controller MKI.ic10:29-38](ic10/SuitControl/Simple%20Suit%20Controller%20MKI.ic10#L29)

The helmet opens whenever external pressure is ≥ 40 kPa for 5 seconds. `MAX_PRESSURE`, `MIN_TEMP`,
`MAX_TEMP` and `MIN_OXY_RATIO` are defined but never used. On Vulcan, or in any room with a pressure
leak or a hot atmosphere, the helmet would open. The README already notes the contamination problem,
but you can catch pressure and temperature with values the suit already reports:

```
l r2 dSuit TemperatureExternal
sgt r1 rExternal MIN_PRESSURE
slt r3 rExternal MAX_PRESSURE
and r1 r1 r3
sgt r3 r2 MIN_TEMP
and r1 r1 r3
slt r3 r2 MAX_TEMP
and r1 r1 r3      # r1 = safe to open
```

### 1.9 Battery Controller 1: divide-by-zero guard checks the wrong register
[VCIC - Battery Controller 1.ic10:128](ic10/EControl/VCIC%20-%20Battery%20Controller%201.ic10#L128)

```
updatePowerDelta:
  beqz r0 zeroGen        # r0 is the battery ratio left over from coalGeneratorRunLoop
  div r0 totalPowerUsage powerTotalOutputSum
```

[VCIC - Battery Control.ic10:83](ic10/EControl/VCIC%20-%20Battery%20Control.ic10#L83) has the correct
version (`beqz powerTotalOutputSum zeroGen`). As written, Controller 1 skips the gauge whenever the
battery is empty and divides by zero when generation is 0. With 0 usage too, that writes `NaN` to the
gauge.

### 1.10 Trader Vert Input: resets the horizontal display on startup
[VCIC Trader Vert Input.ic10:46](ic10/TraderControl/VCIC%20Trader%20Vert%20Input.ic10#L46)

```
sbn NUM_DISPLAY_TYPE HASH("HC Current Value") Setting 0   # should be "VC Current Value"
```

This was copied from the Horz script. Resetting the vertical chip zeros the *horizontal* value.

### 1.11 Air mixer scripts: IC housing shows mixer power, not the status value
[MBA - N-CO2 Mixer [43093].ic10:67](ic10/ClimateControl/AirMixers/MBA%20-%20N-CO2%20Mixer%20%5B43093%5D.ic10#L67),
[VC IC - Fuel Mixing Script.ic10:66](ic10/Misc/VC%20IC%20-%20Fuel%20Mixing%20Script.ic10#L66)

```
mul Status Status r0    # Status now holds either mixer power (0, 1) or NaN.
s db Setting r0         # comment says "NaN means missing devices!" but r0 is never NaN here
```

`Status` is computed but never displayed. Change this to `s db Setting Status` if you want the NaN
indicator for a missing device. This may be inherited from the workshop original.

### 1.12 N-CO2 Mixer: second input is named "O2 Tank"
[MBA - N-CO2 Mixer [43093].ic10:14](ic10/ClimateControl/AirMixers/MBA%20-%20N-CO2%20Mixer%20%5B43093%5D.ic10#L14)

The mixer and output are both "N-CO2", but Gas Input 2 is `HASH("O2 Tank")`. If the tank really holds
CO₂, the name is a copy-paste leftover from the O2-CO2-N mixer. If the tank really holds O₂, the
script is mixing the wrong gas.

---

## 2. Robustness issues

These won't necessarily break anything today, but they make the scripts fragile or cause odd
behaviour in edge cases.

### 2.1 Relative branches (`br*`, `jr`) are easy to break
Several scripts use relative jumps such as `brgt r15 75 4`, `breqz r0 2` and `jr 3`. Inserting or
removing a line, *including a blank line or a comment line*, silently changes where they land. Bug
1.7 is one example. MKII's `breqz rHelmetOpen 5` also only works because the blank line 34 counts as
an instruction.

Use labels except for the tightest loops, such as `breqz r0 -2` in `waitlarre`. You aren't short on
lines in most of these scripts.

### 2.2 Exact-zero / exact-equality checks on pressures
- [Landing Bay IC.ic10:66, 92](ic10/TraderControl/Landing%20Bay%20IC.ic10#L66): `bnez r0 ra` waits for
  hangar pressure to be **exactly** 0.
- [CoolCleanMarsAir [7335].ic10:52](ic10/ClimateControl/CoolCleanMarsAir%20%5B7335%5D.ic10#L52): waits
  for vent output pressure to be exactly 0 while venting into Mars atmosphere, which is not a vacuum.
- [Alaska IC Cooler [101290].ic10:31](ic10/ClimateControl/Alaska%20IC%20Cooler%20%5B101290%5D.ic10#L31):
  same pattern.

Vents slow down as they approach equilibrium, and outward venting stops at the outside pressure.
Either case can leave the state machine stuck. Use a small threshold instead:

```
define EMPTY_KPA 1
bgt r0 EMPTY_KPA ra
```

### 2.3 Landing Bay: `EXT_KPA 0` makes stage 7 a no-op
[Landing Bay IC.ic10:6, 102](ic10/TraderControl/Landing%20Bay%20IC.ic10#L102)

`blt r0 EXT_KPA ra` with `EXT_KPA 0` is never true, so "AddOutsideAir" opens the door on its first
tick. That's fine on the Moon. On a planet with an atmosphere you'd want either the outside pressure
or a reading from an outside gas sensor, so the door doesn't open against a pressure difference.

### 2.4 Coal generator isn't commanded on at startup
[Power Controller Battery.ic10:34-44](ic10/EControl/Power%20Controller%20Battery.ic10#L34),
[VCIC - Battery Controller 1.ic10:77-88](ic10/EControl/VCIC%20-%20Battery%20Controller%201.ic10#L77)

`State` starts at 0 ("charging"), but the generator is only switched **on** when the battery falls
below `MIN_CHARGE` from state 1. If the chip resets with the battery at, say, 50% and the generators
off, they stay off until the battery hits 20%. Either `sb GEN_T On 1` during init, or drive the
output from the state every tick:

```
seqz r1 State
sb GEN_T On r1
```

### 2.5 Cable analyzer: the name is defined, but the code reads by type
[VCIC - Battery Control.ic10:5, 62](ic10/EControl/VCIC%20-%20Battery%20Control.ic10#L62) (same in Controller 1)

`CableAnaylizer_NAME HASH("Base CA")` is defined and listed as required in the README, but
`powerOutput` uses `lb ... CABLE_CA_TYPE PowerRequired Sum`. That **sums every cable analyzer on the
network**, so adding a second analyzer double-counts usage. Use
`lbn totalPowerUsage CABLE_CA_TYPE CableAnaylizer_NAME PowerRequired Maximum`.

### 2.6 Arc Furnace: can turn off a furnace mid-smelt *(verify in game)*
[VC IC - Arc Furnace.ic10:35-46](ic10/FurnaceControl/VC%20IC%20-%20Arc%20Furnace.ic10#L35)

`deactivateOne` runs whenever import slot 0 is empty, before `Idle` is checked. If the furnace has
already pulled the ore in and is still working, this cuts power. Only turn it off when it's both empty
**and** idle:

```
checkWork:
l IsIdle dr0 Idle
ls WaitingOres dr0 0 Quantity
bgtz WaitingOres hasWork
beqz IsIdle ra          # still busy, leave it alone
s dr0 On 0
j ra
hasWork:
beqz IsIdle ra
s dr0 On 1
s dr0 Activate 1
j ra
```

Also, `beq r0 6 init` re-runs the vent setup every 6 ticks. `move r0 0` / `j loop` is enough, and the
`lb r1 ... GasSensor` on line 14 is dead now that its uses are commented out.

### 2.7 Larre Controller: `Mature` is read and thrown away; harvest loop can spin forever
[Larre Controller.ic10:34-49](ic10/FoodControl/Larre%20Controller.ic10#L34)

- Line 34 loads `Mature` into `r0`, and line 36 immediately overwrites it with `Seeding`. If you meant
  to gate on maturity (the README says the plant must be fully mature), add `beqz r0 start` between
  them.
- The `harvest:` loop keeps activating until the plant slot is empty or `Seeding == -1`. If the Larre's
  hand is full, or Activate otherwise does nothing, this never exits. A retry counter that bails to
  the drop-off would make it safe.
- `positionDial` is aliased but unused.

### 2.8 Food Machine Selector: no bounds check on the dial
[Food Machine Selector Controller MKI.ic10:31-34](ic10/FoodControl/Food%20Machine%20Selector%20Controller%20MKI.ic10#L31)

Dial values ≥ 3 index past the table and read `0` as the item hash. Clamp first:
`min r0 r0 2` / `max r0 r0 0`. Line 28 `get sp db 0` is also unnecessary, since `sp` isn't used
after that.

*(Verify in game.)* Item hashes are signed 32-bit. `sll Command Command 8` on a negative hash sets all
the high bits (sign extension). If the sorter ever has trouble with negative hashes, mask first:
`and ItemHash ItemHash $FFFFFFFF`.

### 2.9 Buttons are level-triggered, not edge-triggered
- [VCIC - Printer Control.ic10:100-106](ic10/FabControl/VCIC%20-%20Printer%20Control.ic10#L100)
- [VCIC Trader Horz Input.ic10:62-75](ic10/TraderControl/VCIC%20Trader%20Horz%20Input.ic10#L62) (and Vert)

Each tick that `Activate` reads 1, the value changes again. A press that lasts a few ticks adds
+20 or +30 instead of +10. Remembering the previous button state and acting only on the 0→1
transition fixes it. In Printer Control, the per-fabricator `yield` makes this better or worse
depending on how many fabricators are configured.

### 2.10 Simple Suit MKII: heating and cooling overshoot to the opposite edge of the band
[Simple SUit Controller MKII.ic10:80-90](ic10/SuitControl/Simple%20SUit%20Controller%20MKII.ic10#L80)

`coolingDown` runs until temp ≤ setting − 5, and `coolingUp` runs until temp ≥ setting + 5. Each
mode therefore drives the temperature all the way to the far side of the band, which uses more
power and air than needed. Stop at the setpoint instead (`r0` from `TemperatureSetting`), and keep the
±5 band only as the start condition.

`sleep 5` in `checkClosedHelmet` also pauses all temperature and filtration control for 5 seconds.
A tick counter would avoid blocking.

---

## 3. General suggestions

### 3.1 Consolidate duplicated scripts
Several files are copies with small variations. Each copy is a place where a fix can be missed, which
is what happened in 1.9 and 1.10.

| Group | Files | Suggestion |
|---|---|---|
| Room lighting | `VC-IC Kitchen Bedroom`, `VC-IC Main Hall`, `VCIC Storage Room(1)`, `VCIC-01` | Make one script. Use `bdns Sensor2 skip` to make the second sensor optional. |
| Night extraction | `VC-IC Cold Night Extration`, `VCCR Cooling Air Management (1)` | Identical logic; keep the `VCCR` one (it uses a subroutine). |
| Battery | `VCIC - Battery Control`, `Power Controller Battery`, `VCIC - Battery Controller 1` | The first two look like the "split into 2 chips" from the README TODO. If so, delete or archive Controller 1 and update the README. |
| Trader input | `VCIC Trader Horz Input`, `VCIC Trader Vert Input` | Differ only in the name prefix and the clamp in `saveToDisplay`. |
| Gas mixers | 2× AirMixers + Fuel Mixing | Same engine with different `push` tables. Keep one template and note the per-install values. |

### 3.2 Remove unused defines and aliases
Unused symbols make it look like a feature exists when it doesn't (see 1.2 and 1.8):

- Alaska: `MIN_TEMP`, `MAX_TEMP`
- Filter Controller: `WasteGasT`, `WasteGasName`
- Suit MKI/MKII: `MIN_TEMP`, `MAX_TEMP`, `MAX_PRESSURE`, `MIN_OXY_RATIO`
- Battery Control / Controller 1: `CableAnaylizer_NAME` (see 2.5), `State` (Battery Control), `UPRIGHT_WIND_TURB_T`
- Kitchen Bedroom: `personDetected2`, `Sensor2`
- Larre: `positionDial`
- Arc Furnace: `ArcFurnace1`–`6` (useful as documentation; keep them if you like)

### 3.3 Use named constants instead of magic numbers
- **Colors:** Printer Control already uses `Color.Green` / `Color.Red`. Elsewhere, `Color 5`,
  `Color 4`, `Color 2` and `select r3 r2 2 r3` are hard to read. `Color.Yellow`, `Color.Red`,
  `Color.Green` and similar work in current IC10.
- **Temperatures:** write them in Kelvin with a °C comment, as in `Cold Night Extraction`
  (`define MAX_TEMP_IN_PIPE 453 #180C`). Alaska's raw `303` / `290` don't do this.
- **Thresholds in code:** `0.75` / `0.33` in `batteryPowerOutput` and `50000` in `transformerLever`
  should be defines next to `MIN_CHARGE` / `MAX_CHARGE`.
- **Batch modes:** the borrowed furnace scripts use numeric batch modes (`... Pressure 2`). Your own
  scripts already use `Average` / `Maximum`, so keep doing that.

### 3.4 `sb` writes to every device of that type on the network
The room lighting scripts use `sb deviceHash On personDetected`. That works only because each room has
its own data network. If two rooms ever share a network, or you add a light of the same type
elsewhere, they will fight. The Fab Room script uses `sbn` with a name, which is safer.

### 3.5 Use `ld` / `sd` consistently for reference IDs
[VC-IC Fab Room EControl.ic10:45](ic10/EControl/VC-IC%20Fab%20Room%20EControl.ic10#L45) reads with
`l machineActive machineHash Activate` but writes with `sd machineHash On ...`. This is valid (`l`
accepts `d?|r?|id`), so it's purely style: using `ld` for reads by reference ID would match the `sd`
and the other scripts.

### 3.6 Avoid giving one register two aliases
- Printer Control: `DialAmount` and `Fabricator` are both `r6`.
- Food Selector: `r14` / `r15` are aliased `CommandOp` / `Command` but also used raw for the button
  and switch values.
- Trader inputs: `LoopControl`/`LogicNumPad`, `CurrentButton`/`LogicNumPadConfirmButton`, and
  `Multiplier`/`NumPadCurrentPress` share registers.
- Trading Switch Board: eight aliases over `r0`–`r4`.

None of these is a bug today, because the uses don't overlap. But a future edit that uses both names
in one routine will corrupt one of them silently. You have 16 registers, and most scripts use fewer
than 10.

### 3.7 Debug writes to `db Setting`
Several scripts write `sp`, `-6969`, raw inputs and similar values to the housing for debugging.
That's useful, but it makes the housing display meaningless in normal use. Either remove them, or
pick one meaningful value per script (state number, error code) and document it in a header comment.

### 3.8 Add header comments
The newer scripts (Alaska, CoolCleanMarsAir) have a great header: purpose, required hardware, and pin
assignments. Most of the others have none, and the setup details live only in the README. Even three
lines would help, for example "what this does / d0 = … / required names = …", especially for
`Landing Bay IC`, `Trading Switch Board`, `Sat Control` and `Weather`.

---

## 4. Smaller notes by folder

### ClimateControl
- **Cold Night Extraction / VCCR**: in `ventControl`, `bgt OutsideTemp NIGHT_TEMP_MAX dayTempMode` is
  always true when reached, so it can be a plain `j`. If the sensor is missing, `OutsideTemp` is NaN,
  both comparisons fail, and the code falls into *night* mode. Consider `bdns Sensor` to fail safe.
- **Filter Controller**: the filter only runs in a narrow 23–27 °C window, and too-*cold* waste also
  stops it. That's fine if intentional; otherwise drop the lower bound. There's no hysteresis, but
  `sleep 5` keeps the chatter down.
- **CoolCleanMarsAir**: `maintaintCoolant` typo; `AV_CoolantVent` is the *name* hash and `AV_HASH` the
  *type* hash, so the naming is easy to mix up.

### EControl
- Room lighting: `StructureLightLongWide` and `StructureLightLong` are pushed twice each.
- Main Hall doesn't `snez` the sensor value the way the others do. Kitchen Bedroom has no `sleep 1` in
  `restart`, unlike the rest.
- Fab Room: `alias machineActive r0` inside the subroutine works, but aliases are global. Put it with
  the others at the top.

### FabControl
- **Setup memory slot 6** (`Input amount`) is never read. The controller reads slot 10, which holds the
  same ID. Either drop slot 6 or document it as reserved.
- **Slots 11/12** (`stackSize` / `productionMode`) are written with `poke` but never read back. Both
  are recalculated from devices every loop, so this is write-only state.
- `Printer Setup.ic10`: "Faboricator 5 (Electronics 1)" is stored at slots 13–24, the slots the
  commented-out "Fabricator 2" block lists, and "Fabricator 7" is also labelled "Electronics 1." The
  numbering and labels make it hard to tell which block is live. Typo: "Faboricator."
- README error table (line 37 / 64) no longer matches the current line numbers. Point to the
  `getDeviceAt` offsets instead.

### FoodControl
- **Grow Lights**: `sleep 1` followed by `yield` is redundant. Move the aliases above `start:`.

### TraderControl
- **Weather**: `seq StatusColor Status 1` (line 22) is overwritten on the next line, so it's dead code.
  Also check the color logic: storm < 120 s away gives `5` (yellow), farther away gives `4` (red).
  That looks inverted, unless red was meant for "storm in progress."
- **Sat Control**: the "moving" light only reflects the *medium* dish. Large dish uses `Vertical
  Minimum` but `Horizontal Maximum`. `largeDishLoop` depends on `DESIRE_*` registers loaded in
  `mediumDishLoop`, which is fragile if the call order changes. `CURRENT_VC_VALUE` is reused for Idle
  and the switch state.
- **Trading Switch Board**: turning off the active dock's switch doesn't clear the active dock, so
  stack slot 0 still reports it. Decide whether that's intended.
- **Trader Horz/Vert**: `add Delta LoopControl 0` is just `move Delta LoopControl`.

### Misc
- **Nitrice Crusher**: clean, with good hysteresis. Nothing to change.
- **Mars CO2 Extraction**: fine as a one-shot.

---

## 5. Suggested order of work

1. Fix the real bugs (§1): typo, swapped modes, inverted tests, wrong register, and the copy-paste
   names and displays.
2. Replace exact-zero pressure checks with thresholds (§2.2), and add the startup generator command
   (§2.4).
3. Consolidate the duplicate scripts (§3.1). This makes every later fix a one-place change.
4. Clean up unused symbols, magic numbers and headers (§3.2–3.8) as you touch each file.
