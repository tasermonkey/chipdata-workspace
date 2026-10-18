# Advance Furnace Control
This directory comes from: https://steamcommunity.com/sharedfiles/filedetails/?id=2426326137

## Notes
Common mistakes:
- Forgetting that it has to be a Compact IC housing
- Housing names are important
- Consoles don't matter name

## How it works

The setup uses two chips, and each one sits in an **IC Housing (Compact)**. The housings find each other by name:

| Housing name | Script | Job |
|---|---|---|
| `Hash IC` | `Hash.ic10` | Reads the operator panel, picks the recipe, packs the recipe's control limits into one number, and runs the fuel mixer and vents |
| `Furnace IC` | `Adv Furnace.ic10` | Unpacks the limits, then runs the Advanced Furnace (fuel, coolant, venting, and unloading when the batch is done) |
| `Silos CD` | (another chip) | Only its `Setting` is read: a negative value forces the Hash IC to `off` |

### Devices (all addressed by name with `sbn` / `lbn`)

| Name | Device | Used by |
|---|---|---|
| `Ingot Dial` (Mode 17), `Amount Dial` (Mode 30) | Dial | Both |
| `Confirm Button` | Button | Hash |
| `Override`, `VentLever` | Lever | Hash (`Override` is read into `r7`, but nothing uses it) |
| `Flush` | Lever | Furnace |
| `Vent 1`, `Vent 2` | Active Vent | Hash |
| `O2 Analyzer`, `H2 Analyzer`, `Fuel PA`, `Coolant PA` | Pipe Analyzer | Hash (O2/H2), Furnace (Fuel/Coolant) |
| `Fuel Mixer` | Gas Mixer | Both |
| `Amount`, `SLed` | LED Display (Small) | `Amount` is written by Hash and read by Furnace; `SLed` is the status text |
| `SLight` | LED | Furnace (red = ready, green = active) |
| `A Furnace` | Advanced Furnace | Furnace |
| `FuelPump`, `CoolantPump` | Volume Pump | Furnace |

### The packed recipe number

Each recipe in the Hash IC's jump table is two lines:

```
s db Setting -82508479        # 1) Hash IC's own Setting = the ingot's prefab hash
move r2 0.00350005500100010000 # 2) r2 = four control limits packed into one number
```

The first line stores the hash of the expected ingot. The Furnace IC later compares it with the furnace's `RecipeHash`.

The second line is the packed number. The 20 digits after `0.` are four **5-digit fields**, each a plain integer:

```
0. 00350 | 00550 | 01000 | 10000
   ─────   ─────   ─────   ─────
   r1       r2      r3      r4
   mintemp  maxtemp minpress maxpress
   (K)      (K)     (kPa)    (kPa)
```

So Solder means: keep the furnace between **350 K and 550 K**, and between **1000 kPa and 10000 kPa**.

#### Decoding (`Get` in the Furnace IC)

```
Get:
move r5 0
l r0 db Setting        # the packed value the Hash IC wrote
add r5 r5 1            # r5 = 1, 2, 3, 4
mul r0 r0 100000       # shift the next 5 digits left of the decimal point
trunc rr5 r0           # r[r5] = integer part, so r1..r4 get the four fields
mod r0 r0 rr5          # keep only the fractional part (see below)
brle r5 3 -4           # loop 4 times
j ra
```

Each pass multiplies by 10⁵ to move one field in front of the decimal point. `trunc` stores that field into `r1`, `r2`, `r3` and `r4` in turn, using indirect addressing (`rr5`). The Furnace script aliases those registers as `mintemp`, `maxtemp`, `minpress` and `maxpress`.

The `mod r0 r0 rr5` line is a trick for getting the fractional part. If x ≥ 1, then `x mod trunc(x)` equals `x − trunc(x)`, because x / trunc(x) is always between 1 and 2. A field of `00000` would make this a mod by zero, so every field must be at least 1.

Here is the Solder value worked through:

| Pass | `r0 × 100000` | Stored |
|---|---|---|
| 1 | 350.005500100010000 | `r1` = 350 |
| 2 | 550.0100010000 | `r2` = 550 |
| 3 | 1000.10000 | `r3` = 1000 |
| 4 | 10000.0 | `r4` = 10000 |

#### Precision caveat

IC10 registers are 64-bit doubles, which hold about 15–16 significant digits. A packed value needs up to 18, so the **last field (maxpress) comes out slightly wrong**. When the furnace's decoding is run in float64, the result is off by up to roughly 100 kPa:

| # | Recipe | Packed fields | mintemp | maxtemp | minpress | maxpress (as written → as decoded) |
|---|---|---|---|---|---|---|
| 1 | Iron | `00950 10000 00100 10000` | 950 | 10000 | 100 | 10000 → 9921 |
| 2–7 | Copper, Gold, Silicon, Silver, Lead, Nickel | `00950 10000 01000 10000` | 950 | 10000 | 1000 | 10000 → 9992 |
| 8 | Steel | `00900 10000 01000 10000` | 900 | 10000 | 1000 | 10000 → 9992 |
| 9 | Invar | `01200 01500 18000 20000` | 1200 | 1500 | 18000 | 20000 → 19945 |
| 10 | Solder | `00350 00550 01000 10000` | 350 | 550 | 1000 | 10000 → 10010 |
| 11 | Electrum | `00600 10000 00800 02350` | 600 | 10000 | 800 | 2350 → 2359 |
| 12 | Constantan | `01000 10000 20000 55000` | 1000 | 10000 | 20000 | 55000 → 54928 |
| 13 | Waspaloy | `00400 00800 50000 55000` | 400 | 800 | 50000 | 55000 → 54993 |
| 14 | Inconel | `00600 10000 23500 23800` | 600 | 10000 | 23500 | 23800 → 23714 |
| 15 | Astroloy | `01000 10000 30000 40000` | 1000 | 10000 | 30000 | 40000 → 39919 |
| 16 | Hastelloy | `00950 01000 25000 30000` | 950 | 1000 | 25000 | 30000 → 29941 |
| 17 | Stellite | `01800 10000 10000 19500` | 1800 | 10000 | 10000 | 19500 → 19574 |

The first three fields always decode exactly. The error in maxpress doesn't matter in practice because the band is wide, except for **Inconel**: the furnace starts venting at about 23714 kPa instead of 23800, which leaves a band of only about 214 kPa above minpress.

A **maxtemp of 10000** means "no upper limit", since the coolant pump never turns on. A **maxpress of 55000** means "up to the furnace's cap", because the Furnace IC clamps its pressure reading to 55000.

#### Adding or editing a recipe

1. Write each limit as a zero-padded 5-digit integer: `mintemp`, `maxtemp`, `minpress`, `maxpress`.
2. Join the four fields and put `0.` in front.
3. Keep each block exactly three lines (`s db Setting <ingot hash>`, `move r2 ...`, `j main`). The dial selects a recipe with a relative jump, `brnez r0 r0`, where `r0 = 3 × (dial − 1) + 1`. Adding a line or a comment-only line inside the table moves every recipe after it. Comments on the same line as code are fine.

### Hash IC (`Hash.ic10`) main loop

1. **Panel and vents**: sets the dial modes and turns on the analyzers. If `VentLever` is off, it calls `VentOn`, which sets `Vent 1` to outward mode at 101 kPa and `Vent 2` to inward mode at 101 kPa external / 55000 kPa internal. If the lever is on, it calls `VentOff`, which sets both external targets to 0.
2. **Fuel mixer** (`Mixer`): sets `Fuel Mixer` Setting = `100 / (1 + T_O2 / (2·T_H2))`. At equal input pressures, moles scale with 1/T, so this gives a **2:1 H₂:O₂ molar mix**. It assumes **H₂ is on mixer input 1**.
3. **Reads inputs**: `r0` = Ingot Dial (recipe 1–17, see the table above), `r1` = Confirm Button, `r5` = Amount Dial. If `Silos CD` Setting is negative, it jumps to `off`, which writes 0 to its own Setting.
4. **Clamps**: an Amount of 0 is changed to 1, and an Ingot Dial above 17 is set back to 17.
5. **Expected reagent amount**: computes `r6` = Amount × a multiplier that depends on the recipe group, and writes it to the `Amount` display:

   | Dial | Group | Multiplier |
   |---|---|---|
   | 1–7 | Basic ingots | ×50 |
   | 8 | Steel | ×200 |
   | 9–12 | Alloys | ×100 |
   | 13–17 | Super-alloys | ×50 (the Furnace IC also divides the furnace's `Reagents` by 4 for these) |

6. **Confirm**: if the button reads 1, `Set` writes `r2` to `Furnace IC` Setting. This runs *before* the jump table, so it sends the `r2` chosen on the **previous** pass. Because the loop runs every tick, that is normally the same recipe. If you turn the dial and press Confirm in the same tick, or press it on the first tick after power-up, the stale value or 0 is sent instead.
7. **Jump table**: as described above, it sets its own Setting to the ingot hash and loads `r2`, then returns to `main`.

### Furnace IC (`Adv Furnace.ic10`)

**`start` (idle loop):** clears the limits and turns both pumps off. It turns the `Fuel Mixer` on whenever `Fuel PA` is below 5000 kPa, which keeps the fuel line topped up to about 5 MPa. Separately, `SLight` and `SLed` are switched on only while `A Furnace` is powered on. When they're on, the light is red and the LED shows `Ready!`. Then the furnace output is opened fully (`SettingOutput 100`) if the `Flush` lever is on or the furnace is above 40000 kPa; otherwise it is closed. Each pass writes `db Setting -1` and yields, then reads `db Setting` again. Once the Hash IC has written a positive packed value, the script calls `Get` and drops into `set`.

**`set` (control loop, every tick):**
- Turns the mixer off, sets the light to green and the LED to `Active`, and opens the furnace input.
- Pulses `Activate` (ignite) whenever the furnace is at 600 K or below.
- **Fuel pump volume**: `V·minpress·(maxtemp/T)·500 / (T_f·n_f·8314.46)`. `8314.46·n·T/V` is 1000 × the pipe pressure in kPa, so this works out to about `0.06 · minpress · (maxtemp/T) / T_fuel` mol of fuel per tick. That is more for high-pressure recipes and more when the furnace is cold. A furnace temperature of 0 is treated as 300 K.
- **Coolant pump volume**: works out to about **30 mol/tick × max(1, T/maxtemp)**, so it scales up with overheating. The inline `#8095.8` comment is a leftover.
- **On/off control** (pressure clamped to 55000):
  - Fuel pump on if `T < mintemp`, or if `P < minpress` (the pressure check is skipped when minpress is 0).
  - Coolant pump on if `T > maxtemp`.
  - Furnace `SettingOutput` = 30 if `P > maxpress`, otherwise 0.
- **Done check**: the batch is done when
  - the furnace's `RecipeHash` equals the `Hash IC` Setting (the right ingot is forming), **and**
  - `Reagents` (÷4 for dial ≥ 13) equals the `Amount` display, or `Amount` is 0. When `Amount` is 0 the check also requires an alloy (dial > 7).

  The script also jumps to `end` if someone opens the furnace by hand.

**`end`:** opens the furnace and waits until `Reagents` reaches 0 (the ingots have been ejected). It then resets the Ingot Dial to 0 and the output to 0, and returns to `start`.

