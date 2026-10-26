# Furnace Control (DS-8) reference

What each chip does, and the rack memory they share. The [README](./README.md) has the setup.

## The chips

| Socket | Script | What it does | Owns |
| --- | --- | --- | --- |
| 1 | [Furnace Control](./Furnace%20Control.ic10) | The batch, from Ready to Unload: starts it on the Panel's request, ends it when the ingot is done, and opens the furnace to unload. | The furnace's `Open`, `SettingInput`; STATE, JOB |
| 2 | [Furnace Release](./Furnace%20Release.ic10) | The furnace's output: Flush, over-pressure, venting above the recipe's top pressure, and the emergency release. | The furnace's `SettingOutput` |
| 3 | [Furnace Fuel Pump](./Furnace%20Fuel%20Pump.ic10) | Fuel in while the furnace is under the recipe's lowest temperature or pressure; lights it at 600 K or below. | The fuel pump, the furnace's `Activate`; FUEL_ON |
| 4 | [Furnace Coolant Pump](./Furnace%20Coolant%20Pump.ic10) | Coolant in while the furnace is over the recipe's top temperature. | The coolant pump; COOL_ON |
| 5 | [Furnace Fuel Mixer](./Furnace%20Fuel%20Mixer.ic10) | Two H2 to one O2, topping the fuel line up to 5000 kPa between batches. | The Gas Mixer |
| 6 | [Furnace Panel](./Furnace%20Panel.ic10) | The dials and Confirm, and the amount display. | The dials; REQUEST, TARGET |
| 7 | [Furnace Status](./Furnace%20Status.ic10) | The status display and light, and the pump display. | Those displays |
| 8 | [Furnace Box](./Furnace%20Box.ic10) | Holds the box at 101 kPa: one vent fills it, the other empties it. | The two vents |
| 9 | [Furnace Readouts](./Furnace%20Readouts.ic10) | The furnace's and box's temperature and pressure. Needs the [tmz-opext](https://github.com/tasermonkey/stationeers.tmz-opext) mod: its `show` takes arguments. | The four readouts |
| any, once | [Furnace Recipes Setup](./Furnace%20Recipes%20Setup.ic10) | Writes the recipes to the drive, then stops at `done`. Needs the [tmz-opext](https://github.com/tasermonkey/stationeers.tmz-opext) mod: each recipe is one call. | The drive's recipes |

No two chips write the same thing on a device. Control runs first, so the state every other chip
reads is this tick's.

## The drive

The recipes are on the drive in bay 1 (bank 0, addresses 0-511).

| Address | What |
| --- | --- |
| 511 | How many recipes there are. 0, or no drive, is `NoDisk`. Not cell 0: the rack's Network program writes a device's ID there on F1. |
| 8 × n | Recipe n's ingot (its prefab hash) |
| 8 × n + 1, + 2 | Its lowest and highest temperature (K) |
| 8 × n + 3, + 4 | Its lowest and highest pressure (kPa) |
| 8 × n + 5 | Reagents for each step of the Amount dial |

### The recipes

| n | Ingot | K | kPa | Reagents a step |
| --- | --- | --- | --- | --- |
| 1 | Iron | 950-10000 | 100-10000 | 50 |
| 2-7 | Copper, Gold, Silicon, Silver, Lead, Nickel | 950-10000 | 1000-10000 | 50 |
| 8 | Steel | 900-10000 | 1000-10000 | 200 |
| 9 | Invar | 1200-1500 | 18000-20000 | 100 |
| 10 | Solder | 350-550 | 1000-10000 | 100 |
| 11 | Electrum | 600-10000 | 800-2350 | 100 |
| 12 | Constantan | 1000-10000 | 20000-55000 | 100 |
| 13 | Waspaloy | 400-800 | 50000-55000 | 200 |
| 14 | Inconel | 600-10000 | 23500-23800 | 200 |
| 15 | Astroloy | 1000-10000 | 30000-40000 | 200 |
| 16 | Hastelloy | 950-1000 | 25000-30000 | 200 |
| 17 | Stellite | 1800-10000 | 10000-19500 | 200 |

A top of 10000 K means no limit. A top of 55000 kPa is the furnace's own limit.

### Adding a recipe

Copy the setup chip as `Furnace Recipes Setup 2.ic10`, set its `FIRST` to 18, and leave only the
new recipes in it. Each is one line, `tmjc r0 recipe` with the ingot, its K pair, its kPa pair,
and its Reagents a step. A pair is two 5-digit numbers run together: `0095010000` is 950 to 10000. Running it adds
the new recipes, and the count goes up to the last of them.

## Scratch cells

The rack's eight shared cells, at 4136-4143.

| Address | Name | Written by | What |
| --- | --- | --- | --- |
| 4136 | STATE | Control | The state, below |
| 4137 | REQUEST | Panel; Control clears it | The recipe Confirm asked for, or 0 |
| 4138 | TARGET | Panel | The Reagents at which the batch is done |
| 4139 | JOB | Control | The recipe running, or 0 |
| 4140 | HOLD | any chip | Not 0: no new batch starts |
| 4141 | FUEL_ON | Fuel Pump | 1 while the fuel pump runs |
| 4142 | COOL_ON | Coolant Pump | 1 while the coolant pump runs |

### States

| STATE | Name | Fuel line top-up |
| --- | --- | --- |
| 0 | Idle: the furnace is off | yes |
| 1 | Ready | yes |
| 2 | Hold | yes |
| 3 | NoDisk | yes |
| 4 | Active | no |
| 5 | Unload | no |
| 6 | Emergency | no |

## Settings

`define`s worth changing, by chip:

| Chip | Define | Default | What |
| --- | --- | --- | --- |
| Readouts | `FURNACE_K_MAX`, `FURNACE_KPA_MAX` | 3000, 60000 | A gauge's scale for the furnace. Each chip's own: ic10-link keeps what's set in game. |
| Readouts | `BOX_K_MAX`, `BOX_KPA_MAX` | 600, 200 | A gauge's scale for the box. Each chip's own, likewise. |
| Box | `BOX_AIR` | 101 | kPa the box is held at |
| Fuel Mixer | `TOP_UP` | 5000 | kPa the fuel line is filled to |
| Fuel Pump | `IGNITE_BELOW` | 600 | K at or below which the furnace is lit |
| Release | `FLUSH_ABOVE` | 40000 | kPa above which the output opens between batches |
| Release | `VENT_SPEED` | 30 | The output's setting while over the recipe's top pressure |
| Panel | `MAX_AMOUNT` | 30 | The Amount dial's top step |

**Another drive size.** With the mod's DriveCapacity other than 512, the rack's status registers
move: every address from 4096 up becomes 8 × DriveCapacity + the same offset, in every chip.

**Read-only scratch cells.** If the rack's BIOS sets them read-only, move STATE…COOL_ON to unused
drive cells (500-506, say) in every chip.

## What changed from AdvFurnaceControl

- **The recipes are on the drive,** written exactly, instead of packed into one number. The packed
  number lost some of each recipe's top pressure; Inconel's band shrank to about 214 kPa.
- **The amount display shows the Reagents the batch takes.** For a super-alloy that's 4 times what
  the old display showed. The old furnace chip divided the Reagents by 4, which comes to the same.
- **Done means all the Reagents are in,** or more, not exactly that many.
- **Confirm sends the recipe on the dial now.** The old chip sent the one from the tick before.
- **New: the status states** (Idle, Hold, NoDisk, Unload, Emergency), the pump display, the
  readouts and the emergency lever.
- **The colours are new.** The old light was red for Ready and green for Active.
- **Gone: the unused Override lever, and Silos CD.** A negative Setting on Silos CD stopped the old
  chips; any chip can now set the HOLD cell instead.
- **Every port needs its device.** The old chips ran with no Amount display; these wait for one.
