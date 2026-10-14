# IC10 Code Review

What's still open in the scripts under [ic10/](ic10/). Everything fixed so far is in git history,
and each fix has a test under [tests/](tests/). `npm test` also checks every script against the
game's limits, the device catalogue and a 50-tick run with stand-in devices; `npm run lint` shows
the same findings without the tests.

## To do in game

Scripts changed since they were last pasted into the game need pasting again. These need more:

- **Room Lights** replaces the four room scripts (Kitchen Bedroom, Main Hall, Storage Room,
  VCIC-01). Paste it into each room's chip, set `ROOM_LIGHT` to a name for that room, and give the
  room's lights that name. A light it should switch that isn't named stays as it is.
- **Battery Controller 1** is gone. Run Power Controller Battery and Battery Control on two chips
  instead; together they do everything it did.
- **Cold Night Extraction** is gone. Its chip can run VCCR Cooling Air Management, the same logic.

## Over the game's limits

- **Simple SUit Controller MKII** is 132 lines; the game keeps 128, so its last 4 are lost. It's
  allowed by an override in [ic10-lint.json](ic10-lint.json) that lets it shrink but not grow. Not
  to be trimmed unasked.

## Unused names

ic10-lint's `unused` rule lists these. Each can be removed, or kept as documentation:

- Filter Controller: `WasteGasT`, `WasteGasName`. `WasteGasT` also names a prefab that doesn't
  exist: `HASH("StructureGasPipeAnalyzer")`, where the pipe analyzer is `StructurePipeAnalysizer`.
- Power Controller Battery: `PowerDeltaGauge`.
- Battery Control: `BATTERY_T`, `BatteryPer_NAME`, `CHARGE_LEVEL_T`, `BatteryStorageGuage`, `State`.
- Trading Switch Board: `SW_T`.
- Suit MKI and MKII: the `checkOpenedHelmet` label; MKII also `MIN_OXY_RATIO`.
- Arc Furnace: `ArcFurnace1`–`6` (they document the pins).
- V-IC Hash (Workshop): `Hash`.

## To check in game

- **Printer Control's buttons** assume the console mod's round buttons pulse for one tick, like the
  vanilla Button. If they hold `Activate` longer, a press adds 10 more than once.
- **Food Machine Selector:** item hashes are signed 32-bit, and `sll Command Command 8` on a
  negative hash sets the high bits. If the sorter mishandles negative hashes, mask first:
  `and ItemHash ItemHash $FFFFFFFF`.

## Left as is

- **Filter Controller** only filters at 23–27 °C, so waste gas that's too cold stops it too.
  Intended.
- Relative branches (`br*`, `jr`) remain in a few scripts. A blank or comment line added inside
  their range moves where they land; the tests catch it.
- The Workshop scripts (gas mixers, Advanced Furnace, Solar Power Controller) keep their own style:
  numeric batch modes and colours, and no header comments. The three mixers share their code below
  a settings block, and a test keeps them the same.
