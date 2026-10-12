# IC10 Test Framework: Plan

The goal is a way to write automated tests for the scripts in [ic10/](ic10/). Each test should:

1. describe an emulated game state: networks, devices, their property values, and pipe and room
   atmospheres;
2. run an IC10 script against that state under the game's real execution rules (game ticks,
   auto-yield after 128 lines, `sleep`, halting on errors), for a set number of lines or ticks or until
   a condition holds;
3. change the world while the script runs (scripted events and simple device behaviour);
4. assert on the result: device properties, registers (by name or alias), the stack, errors, and
   which values changed over time.

The plan builds on a fork of [Stationeers-ic/ic10](https://github.com/Stationeers-ic/ic10)
(TypeScript, AGPL-3.0). Engine findings come from reading its source and running a spike against your
scripts on 2026-10-07 (see the Appendix).

## Decisions (2026-10-07)

| Topic | Decision |
|---|---|
| Test style | TypeScript tests using **Vitest** (`describe` / `it` / `expect`) with custom matchers. |
| Location | In this repo, in a **self-contained subdirectory** that can later move to its own repo. |
| Emulator | **Fork** Stationeers-ic/ic10. We may release the fork later under AGPL-3.0. We're not planning upstream PRs. |
| Toolchain | **Node 24+ and npm only, no Bun.** Scripts are written in TypeScript and run natively with Node's type stripping. The fork is converted too. |
| Packaging | The fork must be **real ESM**, loadable by plain Node. |

---

## 1. What the emulator already does

| Capability | Evidence |
|---|---|
| Parses and executes IC10 | Before the Phase 1 fixes, 31 of your 38 scripts passed its validator: G6 failed 2 and G10 failed 4. (The earlier spike counted 37, because it ran the older published build.) With G6 and G10 fixed, 37 pass. The one failure is Alaska's real `move stage 0` bug, and `tests/scripts-load.test.ts` checks this. |
| Device catalogue | 300+ prefabs generated from game data, each with its logic types, Read/Write permissions, slots, connections and modes. |
| Networks and pins | `d0`–`d5`, `db`, and networks of type data, power, pipe, chute and others. Devices have typed ports (`Pipe Input`, `Pipe Input 2`, `Pipe Output`, `Pipe Waste` and so on). |
| `l`/`s`, `lb`/`sb`, `lbn`/`sbn` | Your VCCR script ran correctly in night and day modes. `sbn` updated only the named vents. |
| Environment file | JSON with `chips`, `devices` (`props`, `slots`, `reagents`, `pins`) and `networks`. Loaded by `Builder.from(json)` (upstream spells it `Builer`; renamed in the fork). |
| Stepping and events | `Ic10Runner.step()`, with events for line, register, stack and device reads/writes, and errors. |
| Built-in constants | `Color.*`, `LogicBatchMethod.*`, `GasType.*` and others (about 680). |
| Game-exact math | Uses `exact-ic10-math`, a port of the game's C# math. |

## 2. Gaps found

| # | Gap | Effect | Where it's fixed |
|---|---|---|---|
| G1 | No tick model: `yield` is a no-op and there's no 128-line auto-yield. | "Run N ticks" has no meaning, and preemption can't be tested. | Fork hook plus harness scheduler (§4.2) |
| G2 | `sleep` calls a real `setTimeout`, with the seconds multiplied by 1000 twice. | `sleep 5` makes the test wait 5,000 real seconds. | Fork hook (**done**) plus virtual clock |
| G3 | A cumulative 1000-jump limit. | Every `j start` loop dies with a critical error. The spike was killed after about 3,000 lines. | Harness creates runners with no jump limit and uses its own budgets (§4.3) |
| G4 | Strong runtime errors don't halt. | `move stage 0` logs an error and keeps going, but in game the chip stops. | Harness halts the chip and records it, so tests can assert on it (§4.5) |
| G5 | The validator misses undefined identifiers. | `move stage 0` validates cleanly. | Fork (sandbox check) or harness lint |
| G6 | `define X 0` is rejected. | `DefineInstruction` checks `if (value)`, so 0 is treated as missing. Solar and Landing Bay fail to load. | **Fixed in fork** (`value !== false`, plus `tests/ic10/fork-fixes.test.ts`) |
| G7 | Packaging and initialisation. | The ESM build has extensionless imports and won't load in Node. `Builder.init()` sandbox pass throws `no_network_for_port`. i18n is never initialised. | Fork (§3) |
| G8 | Devices are property bags with no behaviour. | Turning a vent on doesn't move any gas. | **Done**: harness pipes, rooms and model library (§5, Phase 6) |
| G10 | **`ld` and `sd` don't work at all.** `calculateDevicePinOrId` turns a failed pin parse into error code `0`, then treats that as pin 0, so it never tries the ID lookup. `ld r3 $1488 On` and `ld r3 r1 On` both fail with `pin_not_allowed_in_instruction`. | Printer Control can't run (line 38 `ld Tmp Param1 On`), nor can anything else using reference IDs. Device-ID arguments also rejected `define`d IDs (`define DEBUG_1 $4D655` / `sd DEBUG_1 …`). | **Fixed in fork**: a failed pin parse falls through to the ID lookup, and device-ID arguments accept defines. Covered by instruction tests and `fork-fixes.test.ts`. |
| G12 | No **Logic Mirror** in the emulator or its game data. | Scripts that read another network through a mirror can't be tested. | **Done**: fork extension point (`DeviceProps.hooks`) + harness `sim().mirror()` (§5.4) |
| G11 | Instruction errors can **throw out of `step()`** instead of being recorded. | One bad line crashes the test with a JS stack trace instead of halting the chip. | **Fixed in fork** (catch in `step()`); the harness also catches as a safety net |
| G13 | **`jal` and the branch-and-link instructions store the wrong return address**: their own line instead of the next one. Upstream's `beqal` test expected the wrong value. | `j ra` jumps back to the `jal`, so a `jal sub` … `j ra` loop never gets past the call. 31 of the 38 scripts use `jal`. Found by the first `sim()` test in which day comes partway through the run. | **Fixed in fork** (`ra` = line + 1), with tests in `fork-fixes.test.ts` |
| G14 | **Batch reads of no devices all return 0.** In game `Average` is NaN (0 / 0) and `Maximum` is −∞; `Sum` and `Minimum` are 0 (per [dcramer/stationeers](https://github.com/dcramer/stationeers/blob/main/docs/ic10-instructions.md#device-access-and-missing-batch-data), unofficial). | The mixer scripts' "NaN means a missing device" check never fires, so a missing tank looks like the mixer being off. Found writing the review 1.11 test. | **Fixed in fork**, with tests in `fork-fixes.test.ts` |
| G15 | **The "is a device set" instructions error on an empty pin.** `sdse`, `sdns`, `bdse`, `bdns`, `brdse`, `brdns`, `bdseal` and `bdnsal` required a device on the pin, so testing for one halted the chip. | The Arc Furnace script loops over d0–d5 with `bdns dr0` and halted at the first empty pin. | **Fixed in fork**: those instructions take a pin that may be empty, with tests in `fork-fixes.test.ts` |
| G16 | **Slots the game data lists no logic types for read 0.** The Larre's Target Slot (255, the plant at its arm) is one. | `ls r1 larre 255 Mature` always read 0. | **Fixed in fork**: such a slot reads whatever its item has; slots that list their logic types are unchanged |
| G17 | **`sdse` / `sdns` take only a pin.** The wiki gives them `device(d?\|r?\|id)`, so the game also accepts a reference ID (set = on the network). | `sdse r0 $1488` fails in the emulator. No script uses it yet. | Fork, when a script needs it |
| G18 | **Reading a logic type the device can't read is only a warning.** In game `l`, `ld` and `lb` throw `IncorrectLogicType` and the chip halts (read from `Assembly-CSharp.dll`, 2026-10-11). | A script reading the wrong property carries on with 0 instead of stopping. Found while reading the Logic Mirror's code (§5.4); no script in `ic10/` does it. | **Fixed in fork**: such a read is a strong error (the harness halts the chip), with tests in `fork-fixes.test.ts`. `s` no longer reads a write-only logic type's old value. |
| G19 | **A write to something that isn't a register lands in `r0`.** `move Nope 1` or `add Nope r5 1` records the error (and the harness halts the chip), but the result is still written to `r0`. Probably the same pattern as G10, where a failed parse falls back to index 0. | After the halt, `r0` holds the bad instruction's result, so the debugger and failure reports show a value the game wouldn't have. Found writing the debugger's examples (2026-10-11). Alaska's `move stage 0` (review 1.1) was one of these. | **Fixed in fork**: every argument calculator's failure path returned 0 after recording its error, so `r0`, pin 0 or logic type 0 stood in. A strong argument error now throws `ArgumentAbort`, which `Instruction.execute()` catches, so the instruction stops there and the line ends as usual (the harness halts the chip; the validator goes on to report later lines). Weak errors (an unknown device hash) still read as 0. Tests in `fork-fixes.test.ts` and `sim.test.ts`. |
| G20 | **`bdnvl` / `bdnvs` were inverted, and `bdnvl` took a logic type as a plain number.** The wiki: "branch if the device is not valid for a load (store) of that logic type"; the code branched when it was valid. `bdnvl db Setting` was rejected as a number, so logic type 0 stood in. Upstream's instruction tests encoded the inverted behaviour, and the two bugs together made `bdnvl db Setting` look right. | No script in `ic10/` uses them. Found by the G19 fix, which stopped the 0 standing in. | **Fixed in fork**: both branch when the device is not valid; `bdnvl` takes a logic type by name or number; the instruction tests corrected; a test in `fork-fixes.test.ts`. |
| G21 | **`sapz`, `snaz`, `bapz`, `bnaz`, `brapz`, `brnaz`, `bapzal` and `bnazal` lack the `b` operand.** The wiki gives `sapz r? a b` and `bapz a b c`: abs(a) <= max(b * abs(a), eps * 8). The fork takes one operand fewer and hard-codes abs(a) <= eps * 8. Its `sapz`/`snaz` tests use the short form. | `sapz r1 5 1` fails with "Invalid count of arguments: 3 (expected: 2)". Valid game code errors out. Audit 2026-10-12, verified by probe. **In-game check (Test A, 2026-10-12):** the game accepts all four forms and matches the wiki (`sapz 5 1` = 1, `sapz 5 0.1` = 0, `snaz 5 0.1` = 1, `bapz 5 1` branches). The fork is wrong. | **Fixed (node-esm)**: `sapz`, `snaz`, `bapz`, `bnaz`, `brapz`, `brnaz`, `bapzal` and `bnazal` take the b operand (`abs(a) <= max(b * abs(a), eps * 8)`). Upstream's one-operand `sapz`/`snaz` tests are corrected with a change notice. Tests in `fork-fixes.test.ts`. |
| G22 | **`sna`, `bna`, `brna` and `bnaal` give "not equal" for a NaN operand.** The fork negates `approxEqual`. The wiki formula is `abs(a - b) > max(...)`, which is false for NaN. | `sna r1 NaN 1 0.1` gives 1 (the wiki formula gives 0); `bna` branches. **In-game check (2026-10-12, Audit 01):** `sna` gives 0 with a NaN operand, `sap` gives 0, `sne` gives 1, and `bna` does not branch. The game matches the wiki's `>` formula, so the fork is wrong. Fix: compare directly, not by negating `approxEqual`. Confirmed by the user against the game results (Audit 01). | **Fixed (node-esm)**: `sna`, `bna`, `brna` and `bnaal` compare directly (`abs(a - b) > tol`), so a NaN operand is false. Tests in `fork-fixes.test.ts`. |
| G23 | **`get`, `put`, `bdnvl` and `bdnvs` take only a pin.** The wiki gives them `device(d?\|r?\|id)`, as `l` and `s` take. A register or ID operand fails with "must be device pin". | Same shape as G17. `get r1 r5 0` halts the chip. Audit, verified. | **Fixed (node-esm)**: `get`, `put`, `bdnvl` and `bdnvs` take a register or ID as the device, as `l` and `s` do. A pin is still checked for a connected device. Tests in `fork-fixes.test.ts`. Side note, not part of G23: `l r d0 ReferenceId` reads 0 for a gas sensor in the fork. |
| G24 | **A device with no memory doesn't halt `get`, `put`, `getd`, `putd`, `clr` or `clrd`.** The wiki: they throw MemoryNotReadable / MemoryNotWritable. The fork adds a weak "device_no_memory" error and reads 0 or drops the write. Device memory (`DeviceMemory`) also has no bounds check at all. | A script that reads a memory-less device carries on with 0. Audit, from code reading only (no memory-less device probed). **Fixed in fork (node-esm), tests in fork-fixes.test.ts:** get/put/clr on a device without memory halt with MemoryNotReadable / MemoryNotWriteable, as the game does. | **Fixed (committed)** |
| G25 | **Stack bounds are wrong.** `Stack.set` tests the number of stored entries, not the index, so `poke 9999 1` or `poke -1 1` succeeds on a near-empty stack and a `poke` to an existing address on a full stack overflows. `get db -1` reads 0. `pop` and `peek` on an empty stack read 0 with no error; the wiki says out-of-bounds reads and writes raise a stack underflow/overflow exception. Upstream's `pop`/`peek` tests assert the 0. | A script that underflows reads 0 and carries on instead of halting. Audit, verified by probe (`poke`, `get db -1`, `pop`, `peek`). **In-game check (Test N, 2026-10-12):** `pop r0` on an empty stack halts with `StackUnderFlow` at the pop line, and r0 keeps its old value (not written as 0). The game matches the wiki, so the fork's silent 0 is wrong. **Resolved (Hold/Resume test, 2026-10-12):** the chip was NOT halted. `sp` froze while paused and changed again on resume (it reached -66, then -295). So after `StackUnderFlow` the game keeps retrying the same line every tick, and each try decrements `sp`. The error banner shows, but the chip keeps going. **Consequence:** for the `ext`/`ins` tests, "r1 unchanged" shows only that the line wrote nothing; it does not prove a halt. Whether those errors also retry is not yet tested. **Confirmed (Test O, 2026-10-12):** a `add r2 r2 1` placed before the failing `pop` did NOT repeat. r2 stayed put while sp kept moving, so only the failing line repeats, not the whole script. **Also seen:** pasting new code reset `sp` to 0, while the other registers kept their values. **Test P (2026-10-12):** `peek r0` on an empty stack raises `StackUnderFlow` at the peek line, leaves `sp` at 0 (as the wiki says peek should), and writes nothing to r0 (the fork's silent 0 is wrong here too). **Test Q (2026-10-12):** `poke 600 1` raises `StackOverFlow` at the poke line; `sp` stays 0. The game's error names are `StackUnderFlow` and `StackOverFlow`. **Test R (2026-10-12):** `poke -1 1` raises `StackUnderFlow` at the poke line; `sp` stays 0. **Test S (2026-10-12):** `get r0 db -1` raises `Unknown` (not StackUnderFlow) at the get line; `sp` stays 0. The tester had set r0 to 42 by hand beforehand, and it stayed 42, so the failed `get` wrote nothing to r0. **Test T (2026-10-12):** `push 1` in a loop raises `StackOverFlow` at the push line with `sp` = 512 and all 512 entries set to 1. The overflow is at 512, as the wiki says. **Test U (2026-10-12, Wall Light on d0):** `get r0 d0 0` raises `MemoryNotReadable` at the get line, as the wiki says, and r0 stays 42 (unchanged). The fork returns a weak error and 0, so the fork is wrong (G24 confirmed in game for `get`). **Test V (2026-10-12):** `put d0 0 1` raises `MemoryNotWriteable` (the game's spelling) at the put line, as the wiki says. **Test W (2026-10-12):** `clr d0` raises `MemoryNotReadable` at the clr line. The wiki's "likely a bug" note is about the name only; the game uses MemoryNotReadable. The memory group (U, V, W) is done, and G24 is confirmed for get, put and clr in game. **Test X (2026-10-12):** `l r5 db ReferenceId` then `get r1 r5 0` runs with no halt: r5 = 880 (the housing's ID), r1 = 1 (stack entry 0). So the game takes a register holding an ID as the device, and the fork does not (G23 confirmed in game). | **Fixed (committed)**: pop, peek, poke and get raise StackUnderFlow / StackOverFlow by index (pop lowers sp first, as the game does); the upstream "empty stack" tests that expected 0 are removed with a change notice; tests in fork-fixes.test.ts |
| G26 | **`rmap` crashes** with a JS TypeError (`[1]` of an empty filter result) and never uses its device argument, so the harness sees a critical error with no sensible message. It has no test. **`lr` with Required (1) and Recipe (2) returns 0** with a warning, where the wiki defines both. | Audit, `rmap` verified; `lr` from code reading. | **rmap fixed (node-esm)**: no TypeError. The first reagent with the hash is used, and an unknown hash writes 0. It still ignores its device, as there is no per-device data. **`lr` Required and Recipe fixed (node-esm)**: `tools/generate-recipes.ts` (`npm run generate:recipes`, given the export or STATIONEERS_DIR) writes `src/Defines/recipes.ts`, the 10 fabricators' 545 recipes from the Stationpedia export. Recipe reads the selected recipe's amount, Required is max(0, recipe − contents), and any other device raises IncorrectReagentDevice. Tests in `fork-fixes.test.ts` from the game runs below. **In-game check (Test lr, 2026-10-12, Autolathe, EVA suit recipe):** `s d0 RecipeHash <item hash>` selects the recipe. Recipe gives the recipe's amount (Iron 5, Copper 5), and 0 with no error for a reagent the recipe lacks (Gold). Required gives the recipe amount minus what the device holds (Iron 5 empty, 3 after adding 2 iron). The recipe amounts are in the game's Stationpedia export (item `Recipes`, by `CreatorPrefabName`), which the fork would need as data. **In game:** an overfilled Autolathe reads Required 0 (clamped), and a Furnace or Advanced Furnace raises `IncorrectReagentDevice` for Recipe. **From the DLL** (`ProgrammableChip._LR_Operation`, decompiled 2026-10-12): Required and Recipe need a device that implements `IRequireReagent` (the fabricators: Autolathe, Electronics Printer, Hydraulic Pipe Bender, Tool Manufactory, Security Printer, Organics Printer, Automated Oven, Advanced Packaging Machine, Rocket and Terraforming Manufactory); any other device raises `IncorrectReagentDevice`. Required is max(0, recipe − contents) per reagent. With no product selected, a fabricator uses its first product's recipe (unchecked in game). Tests in `fork-fixes.test.ts`. |
| G27 | **`ins` passes its arguments in the wrong order** to `exact-ic10-math` (the register *index* as the base value), so the wiki's own example writes NaN. **`ext` and `ins` write NaN to the register for every out-of-range case** with no error; the wiki names ShiftUnderflow / ShiftOverflow / PayloadOverflow. The thresholds in the library and the wiki also differ (length 0, offset 0, `offset + length == 53`). | Audit, verified (`ext r1 255 60 4` gives NaN and carries on; the thresholds are from code reading). **In-game check (Test D, 2026-10-12):** the wiki examples are right in game: `ext r1 $DEADBEEF 8 16` = 44478 ($ADBE), and `ins` with the wiki's arguments gives 3735928559 ($DEADBEEF). The fork's `ins` gives NaN, so the argument-order bug is confirmed. **Thresholds, in game (one run each):** `ext r1 255 0 4` (offset 0) is accepted and gives 15, so the wiki's "offset smaller than 1 throws" is wrong. The fork agrees. `ext r1 255 4 0` (length 0) **throws ShiftUnderflow** in game and halts the chip, with r1 unchanged. The wiki's "length 0 is allowed" is wrong. The game halts the chip. The fork (the emulator) does not halt: it writes NaN and the script carries on. The fork's no-halt behaviour for bad ranges is from code reading and the `ext r1 255 60 4` probe (it wrote null, and the next line ran), not from a probe of length 0 itself. `ext r1 255 53 1` (offset 53) **throws ShiftOverflow** in game and halts with r1 unchanged, matching the wiki. The fork's behaviour for offset 53 is the same as for length 0 (no halt, NaN). `ext r1 255 4 60` (length 60) **throws PayloadOverflow** in game and halts with r1 unchanged, matching the wiki. The fork doesn't halt for it either (from code reading, with the same caveat as above). `ins r1 5 4 0` (length 0) **throws ShiftUnderflow** in game and halts with r1 unchanged, matching the wiki. The fork writes null with no halt (the Audit probe showed the same for `ins`). `ins r1 1 50 3` (offset + length = 53) **does not halt** in game. r1 = 1125899906842620, about 2^50 (the field 1 at bit 50). So the wiki's "offset + length >= 53 throws PayloadOverflow" is wrong at 53: the game allows it. The fork's library also allows 53 (code reading). `ins r1 1 51 3` (offset + length = 54) **throws PayloadOverflow** in game, r1 unchanged. So the game's limit is offset + length ≤ 53: the wiki's "≥ 53 throws" is off by one (it should read "> 53"). The fork's library has the same accept set (code reading); the fork's problem is that it returns NaN instead of halting. **G27 thresholds are settled**; the fix is the error path. | **Fixed (node-esm)**: `ins` takes the register's current value as its base and the wiki's argument order (the old call passed the register index); `ext` and `ins` raise ShiftUnderflow / ShiftOverflow / PayloadOverflow as strong errors and leave the register alone. The game's limits are used throughout (offset + length above 53 is PayloadOverflow). Tests in `fork-fixes.test.ts`. |
| G28 | **`rol` / `ror` rotate 32 bits.** The wiki rotates a 64-bit value (`ror $1234 4` -> `$4000000000000123`). The fork gives `$40000123`, and upstream's tests assert 32-bit results. | Audit, verified. **In-game check (Test C, 2026-10-12):** the game is not 32-bit. `rol 1 31` = 2147483648 (positive; the fork gives -2147483648). `ror $1234 4` = 4503599627370790 (about 2^52; not the wiki's 4.6e18). `rol 1 63` = 512, which fits a rotate of 54 bits (63 mod 54 = 9). `ror 1 1` = -9007199254740990. The game isn't 64-bit either. **Width test (2026-10-12):** `rol 1 52`, `rol 1 53`, `rol 1 54`, `rol 1 55`, `ror 1 1` gave r0 ≈ 4503599627370500 (2^52), r1 ≈ -9007199254740990 (-2^53), r2 = 1, r3 = 2, r4 ≈ -9007199254740990 (-2^53). That is a 54-bit rotate, read as a signed value (the count wraps mod 54: 54 → 1, 55 → 2). Confirmed by the tester's plain-text read (2026-10-12): r0 = 4503599627370500, r1 = -9007199254740990, r4 = -9007199254740990. The big values are off from exact 2^52 by +4 and from -2^53 by +2, so the game is not exact there (cause unknown). **Precision test (2026-10-12):** `rol 1 40` = 1099511627776 (exact); `rol 1 50` = 1125899906842620 (exact 2^50 is …624, so −4); `rol 1 51` = 2251799813685250 (exact …248, so +2); `ror 1 2` = 4503599627370500 (exact …496, so +4); `ror 1 3` = 2251799813685250 (exact …248, so +2). So values up to 2^40 are exact, and from about 2^50 up the game is off by a few units (relative error about 1e-15). The cause is not known. **Decision (2026-10-12):** match the game's 54-bit signed rotate, and accept the game's few-unit rounding above 2^40. The fork's 32-bit rotate is wrong. | **Fixed (node-esm)**: `rol`/`ror` rotate the game's 54-bit signed value (count mod 54). Above about 2^40 the game is a few units off the exact value; the tests allow that. The upstream 32-bit expectations for `rol r2 1 31` and `ror r2 -2147483648 1` are corrected with a change notice. Tests in `fork-fixes.test.ts`. |
| G29 | **`mod` with a negative divisor.** The fork gives `mod 22 -20 = 2`, `mod 5 -3 = 2` and `mod -4 -3 = -4`. The wiki lists 18 for the first (and for `22 -10`), which looks like a wiki error. Positive divisors match. | Audit, verified. **In-game check (Test B, 2026-10-12):** the game gives `mod 22 -20` = 2, `mod 22 -10` = 2, `mod 5 -3` = 2, `mod -4 -3` = -4, `mod -7 4` = 1. That matches the fork exactly, so the fork agrees with the game and the wiki's 18s are wrong. The fork's `mod -4 -3` = -4 is odd but is what the game does. Decision: keep the fork's `mod`; correct the wiki note (the reference copy in `ic10-test/local/` is the wiki's own, so note it there). | **Resolved**: the fork matches the game |
| G30 | **`-Infinity` is read back as `+Infinity`.** `parseArgumentAnyNumber` passes every operand through `jsThing`, which maps -Infinity to Infinity (and -0 to 0). | `move r0 ninf` stores +Infinity; `log r2 0` stores -Infinity, but `move r3 r2` copies +Infinity. Audit, verified. **In-game check (Test F, 2026-10-12):** the game keeps the sign: `move r8 ninf` = -Infinity, `move r9 r8` = -Infinity, `log r10 0` = -Infinity, `move r11 r10` = -Infinity. The fork is wrong. | **Fixed (node-esm)**: `jsThing` keeps the sign of -Infinity. The upstream test that expected +Infinity is corrected with a change notice. |
| G31 | **`jr` with a negative offset lands one line too early** (`t = abs(r) + 1`): `jr -2` at line 5 goes to line 2, not 3. Upstream's tests only pass because the result is clamped at 0. A `jr` with an invalid argument re-runs the same line forever (its `end()` always returns true), so the jump limit never fires. | Audit, verified: the offset in a probe, and a probe with `jr Nope` that never finished. **In-game check (Test Z2, 2026-10-12):** `jr -2` at line 5 lands on line 3 (`move r7 5`), the wiki's relative target. The game is correct; the fork lands on line 2, so the fork is wrong. The bad-argument loop is still unchecked. | **Open** (offset confirmed as a fork bug; loop unchecked) | **Offset fixed (node-esm)**: `jr` adds the offset to its own line, whatever its sign. A bad argument (`jr Nope`) no longer re-runs its line: it records a strong error and the line ends as usual. In game (2026-10-12) `jr Nope` halts with IncorrectVariable at that line, with r6 = 1 and r7 = 0. Fixed (node-esm); test in `fork-fixes.test.ts`. |
| G32 | **A jump to its own line falls through.** `InstructionLine.end()` advances when the next line equals the current one, so `j 1` on line 1 and `beqz r0 1` on line 1 carry on to line 2. Only `jr` opts out. | A script that spins on its own line (waiting on a condition) doesn't wait. Audit, verified for `j` and `beqz`. **In-game check (Test G32, 2026-10-12):** `move r0 0` / `j 1` / `move r0 1` leaves r0 = 0 and the pc on `j 1`; the chip spins on its own line. The game is correct, so the fork is wrong (it falls through to line 2). | **Fixed (node-esm)**: the advance after a line checks whether a jump happened (the jump count), not whether the pointer moved, so a jump to its own line spins. Tests in `fork-fixes.test.ts`. |
| G33 | **Malformed numbers are accepted.** `$ZZ` and `%2` become NaN (`parseInt` isn't `false`, so no error), and `parseFloat` reads `12abc` as 12. | `move r0 $ZZ` stores NaN with no error. Audit, hex verified; the `parseFloat` case is from code reading and the game's behaviour is unverified. **In-game check (Test G33, 2026-10-12):** `move r0 $ZZ` raises `IncorrectVariable` at line 0 and the chip stops there; r0 stays 0 and the next line (`move r1 5`) never runs. The game rejects it; the fork stores NaN silently, so the fork is wrong. `%2` and `12abc` are still unchecked. | **`$ZZ` fixed (node-esm)**: a hex literal with a non-hex digit is refused, so it raises the strong invalid-argument error, and the harness halts the chip there. The core `step()` still runs the next line, as it does for other strong argument errors; the game names this IncorrectVariable and does not run it. In game `%2` and `12abc` also raise IncorrectVariable (Tests %2 and 12abc, 2026-10-12), so `parseBin` and the decimal parser now refuse anything that isn't a whole number. Fixed (node-esm); tests in `fork-fixes.test.ts`. |
| G34 | **Smaller mismatches.** `hcf` records a *strong* error, so the chip carries on (only critical errors halt; the harness halts on strong anyway). `ss d0:1 ...` records an error but still writes. `lbs`/`lbns` raise a strong "no slots" error for a device with no slots. A `define` runs when its line does, not at compile time. Upstream's `define t1 label` test asserts r0 = 0 only because `move r0 t1` aborts. | Audit. `hcf` verified; the rest from code reading. | **Fixed (node-esm)**: `hcf` is critical, so the chip halts. `ss` with a channel returns before it writes. Settled from the game's DLL (`ProgrammableChip`, decompiled 2026-10-12): a slot read the device can't make (no slots, or no such slot) halts the chip with the register unwritten. `ls` raises IncorrectLogicType; `lbs`/`lbns` check every matching device first and raise IncorrectLogicSlotType. The fork did neither (a strong error, then 0 written). Not done: the game also refuses a slot type the slot doesn't support (Pressure on a slot that isn't a gas canister). `define` is set when the script compiles (the game's `_DEFINE_Operation` adds it in its constructor and does nothing at run time), so a define works above its line; the fork now sets defines in `init()`. A second define of a name the script already defined is the game's ExtraDefine compile error, and the fork now refuses the whole script for it, as it does for G35 (built-in constants don't count). Tests in `fork-fixes.test.ts`; the debugger's Defines scope lists defines before aliases now (`debug-agent.test.ts` updated). |
| G35 | **A label followed by an instruction on the same line is silently dropped.** The fork's label regex is unanchored, so `top: add r0 r0 1` is read as a label `top` and the `add` is ignored, with no error. | **In-game check (Test 10c, 2026-10-12):** the game refuses the whole script with a compilation error, `UnrecognisedInstruction` at line 0, and never runs it (r0 stays 0). So the fork is wrong: it should be a compile error. | **Fixed (node-esm)**: the label regex is anchored, so `top: add ...` is an unknown line. That line is a critical `UnrecognisedInstruction` compile error, and the whole script is refused: no line runs. Test in `fork-fixes.test.ts`. |
| G9 | Toolchain is Bun-only. | Tests import `bun:test`, scripts run with `bun tools/*.ts`, there's a `bunfig.toml`, and CI uses Bun. | Fork conversion (§3) |

**Instruction audit, pass 1 (2026-10-12), against `ic10-test/local/instructions.md`.** Read-only: nothing in the fork has changed. G21–G34 are the findings. The fork registers all 151 wiki instructions plus `ld` and `sd`, which the saved wiki list doesn't have (`l`/`s` take an ID directly there); they're kept. Checked with no discrepancy: the plain compare and branch families (`seq`..`snez`, `b*`/`br*` with two or three operands, relative offsets), the `*al` forms (`ra` = next line, written only when the branch is taken), `select`, `sap`/`bap`, `snan`, the basic and trig math, `clamp`, `lerp`, `sgn`, the bitwise ops `and` `or` `xor` `nor` `not` and the shifts, `l`/`s`/`ls`/`lb`/`lbn`/`sb`/`sbn`/`sbs`, `lr` Contents and TotalContents, `getd`/`putd`/`clrd` operand forms, `alias`, `move`, `yield`, `sleep`.

Not logged as findings, because the wiki is silent and the game's behaviour is unverified: running off the last line (game test 10a, 2026-10-12: the game does not wrap; r0 went 0 → 1 and the chip sat past the end, so the fork agrees). A `j` past the end (game test 10b): no error, the chip shows line 50 and sits there, and r0 stays 1, so it matches running off the end, negative or fractional jump targets, a label and an instruction on one line (now G35: the game refuses the script to compile), the 128-line and 4096-character limits (the fork enforces neither), `round` ties (the fork rounds half to even), batch reads over devices that lack the logic type (game test Y, 2026-10-12: `lb` raises IncorrectLogicType and r0 is unchanged; the fork also raises a strong error, so they agree), and `alias ra r5` (the fork rebinds `ra`). Wiki typos, not fork bugs: `bapal` and `bnaal` describe the wrong condition, `snaz` omits `* 8`, `ceil`/`floor` omit "or equal".

---

## 3. The fork: convert to Node 24 + npm + ESM

This is the largest up-front piece of work. The Bun dependence turned out to be fairly shallow:

| Item | Today | Change |
|---|---|---|
| Test runner | 9 files import `bun:test`, plus `tests/setup.ts` and `bunfig.toml`. | Switch to Vitest; the APIs are nearly identical. `bunfig` preload becomes `setupFiles`. Snapshots are regenerated. |
| Tool scripts | `bun tools/*.ts` (download, generate-*); `tools/whatch.ts` uses the Bun API. | `node tools/*.ts` using Node 24 type stripping. Rewrite the watcher with `fs.watch`. |
| Import aliases | **462 files** import via `@/…`, which Node can't resolve. | Codemod to relative imports **with `.ts` extensions**. Build with `rewriteRelativeImportExtensions` so the published JS imports `.js`. This is also the ESM fix (G7). |
| TS-only syntax | `enum` or `namespace` in `Errors.ts`, `Stack.ts` and `ParserV1.ts`. | Convert to `as const` objects, so Node's strip-only mode can run the source directly. |
| Lockfile and CI | `bun.lock`; the workflow uses Bun. | `package-lock.json`; the workflow uses `actions/setup-node` with Node 24. |
| Build | Vite plus `tsc` plus `tsc-alias`. | Keep Vite (it runs on Node) or switch to plain `tsc`. `tsc-alias` is no longer needed. |

The fork then gets the engine fixes:

1. **Suspend signal (G1, G2).** `yield` and `sleep(s)` record a pending suspend instead of doing
   nothing or calling `setTimeout`. `step()` exposes it, and the harness scheduler acts on it.
   *Done (fork side):* after each `step()`, `runner.suspend` is `{ kind: "yield" }`,
   `{ kind: "sleep", seconds }` or `null`, and a `suspend` event fires. `sleep 0` (or negative) acts as a `yield`, as in game (confirmed
   2026-10-07).
   This also fixed upstream's `sleep N`, which multiplied by 1000 twice (N × 1000 real seconds).
   The 128-line auto-yield and the virtual clock belong to the harness scheduler (Phase 2).
2. **`define` zero (G6).** Done: `parseArgumentAnyNumber` returns `false` on failure, so the check is `value !== false`.
3. **Initialisation (G7).** Fix the sandbox network lookup and default i18n to English. *Done:*
   `src/Languages/lang.ts` initialises synchronously in English when loaded, with every bundled
   language available through `i18n.changeLanguage()`.
4. **`ld` / `sd` by reference ID (G10).** Only treat the argument as a pin when `getDevicePin`
   succeeds, otherwise resolve it as an ID (a literal like `$1488` or `5256`, or a register holding
   one). Add tests for literal, hex, register, and an unknown ID. *Done.* Side effect: `l` and `s`
   share the same argument type, so `l r0 r14 Activate` (Fab Room line 45) now works too. That is
   correct: the in-game docs give `l r? device(d?|r?|id) logicType`, so `l`/`s` accept a register
   or a reference ID as well as a pin (confirmed 2026-10-07).
5. **Errors never escape `step()` (G11).** Catch instruction exceptions and record them as chip errors.
   *Done:* anything thrown while a line runs (an `Ic10Error`, a plain `Error`, even a bare string)
   becomes a **critical** error on that line. The chip stops, `step()` returns `false`, and
   `error` → `fatalError` → `stop` are emitted. The jump-limit error now has `code: "JUMP_LIMIT"`,
   so `Builder.init()` can reject scripts whose validation pass threw, while still accepting
   endless loops. `DeviceSlots` throws a real `Error` instead of a string.
6. **Undefined identifiers (G5).** Report them in the sandbox pass. *Optional; the harness lint can
   cover this instead.*

**Divergence risk.** Converting 462 files makes it hard to merge future upstream changes. Most of
those changes will be game-data refreshes, which come from the fork's own `download` / `generate`
tools, so we mostly regenerate rather than merge. Keep the codemod as a **re-runnable script** in the
fork (`tools/codemod-esm.ts`), so it can be re-applied to a fresh upstream checkout if needed.

---

## 4. Harness design

### 4.1 Layout
```
chipdata-workspace/
├── package.json              # npm workspaces: ["ic10-test", "vendor/ic10"]; "test": "vitest"
├── vitest.config.ts          # includes tests/**/*.test.ts; loads ic10-test matchers
├── vendor/ic10/              # git submodule → your fork
├── ic10-test/                # THE HARNESS: self-contained package, movable later
│   ├── package.json          # name e.g. "@tasermonkey/ic10-test"; depends on the fork
│   ├── src/
│   │   ├── engine/           # adapter: the ONLY code touching emulator internals
│   │   ├── world/            # World builder, devices, pipes/rooms, events, models
│   │   ├── scheduler/        # ticks, auto-yield, sleep, budgets
│   │   ├── matchers/         # Vitest expect.extend matchers
│   │   ├── catalog/          # device and property metadata (§6)
│   │   ├── debug/            # debug gate + the agent the adapter talks to (§6b)
│   │   └── lint/             # static checks (later)
│   └── test/                 # the harness's own tests
├── ic10-test-vscode/         # VS Code extension: DAP adapter, CodeLens (§6b); its own package
│   └── examples/             # one test + .ic10 per debugger feature, to try it on
└── tests/                    # tests for YOUR scripts, mirroring ic10/
    └── ClimateControl/VCCR-cooling.test.ts
```
Moving `ic10-test/` to its own repo later only means changing its fork dependency from a workspace
reference to a git URL.

### 4.2 Execution model: game ticks
- **1 tick = 0.5 s of game time** (`tickSeconds`, configurable). In each tick, every chip runs until
  one of these happens:
  - `yield`: the chip is done for this tick.
  - `sleep n`: the chip is parked until virtual time reaches `now + n`.
  - **128 lines executed: automatic yield.** The chip resumes at the next line on the next tick.
  - A halt: an error, or running off the end of the script.
- **World events and device models run between ticks**, so the world can change between any two
  slices of 128 lines, as it can in game.
- With several chips, they run in a fixed, configurable round-robin order within each tick.
- **Comment, label and blank lines count toward the 128 by default**, matching the game (confirmed
  2026-10-07) and Ryex's ic10emu (it compiles every source line, including blanks and comments, to a
  `Nop` step). It stays configurable. Developers can change both settings, per world or per chip:
  ```ts
  sim({ linesPerTick: 128, countNonInstructionLines: true })   // defaults
  ```
  With `countNonInstructionLines: false`, only instruction lines use up the budget.

**Where these numbers come from.**

| Rule | Source | Confidence |
|---|---|---|
| 1 tick = 0.5 s | Stationeers wiki energy reference ("1 Watt per 0.5 real time seconds"). The game's own text only says `yield` "Pauses execution for 1 tick", with no length. | Good, but secondary |
| At most 128 lines per tick, then auto-yield with no error | Ryex/ic10emu `run_programmable`: 128 steps, then state `Yield`. Forum posts describe the same rule. | Good |
| Blank, comment and label lines count | Confirmed in game (2026-10-07). ic10emu also compiles them to `Nop` steps. | Confirmed |
| An error stops the chip and sets the housing's `Error` to 1 | ic10emu `step()` | Good |

One guide claims that hitting 128 lines throws a "too many operations" error instead of
auto-yielding. Nothing else supports it, so it may describe an older game version.

**In-game check (5 minutes, settles all of it).** Run each script for 60 real seconds and read
`db Setting`:

```
# A: tick length. Expect about 120 after 60 s (2 ticks per second).
loop:
yield
add r0 r0 1
s db Setting r0
j loop
```
```
# B: 128-line auto-yield. No yield; 4 lines per pass, so about 32 passes per tick.
# Expect about 120 × 32 = 3,840 after 60 s, and no error.
loop:
add r0 r0 1
s db Setting r0
j loop
```
- Add 4 comment lines inside B's loop. If comments count, the result roughly halves (about 1,920).
- If B shows an error instead of counting, the game errors at 128 lines rather than auto-yielding.

**Testing preemption.** The scheduler counts auto-yields per chip, and the matchers expose them:

```ts
expect(chip).toNeverAutoYield();                // every loop path hits a yield/sleep
expect(chip).toAutoYieldAtMost(1, { perTicks: 10 });
```

There's also a **preemption sweep**. It re-runs a scenario with a world event injected at each
possible preemption point, then checks that the outcome is the same. This catches scripts that read
several devices across a 128-line boundary and act on an inconsistent snapshot.

### 4.3 Run controls and budgets (the "timeout" equivalent)
Every run call has a game-time budget. Exceeding it **fails the test with a trace**, the way Vitest's
`timeout` does, except it's measured in ticks and lines instead of milliseconds.

| Call | Meaning |
|---|---|
| `step(n = 1, chip?)` | Execute *n* lines, ignoring ticks. |
| `runTicks(n)` / `runSeconds(s)` | Advance game time. |
| `runUntil(pred, { maxTicks })` | Run until `pred(world)` is true; fail if `maxTicks` passes first. |
| `runUntilLine(label \| index, { maxTicks })` | Run until the chip is about to execute that line. |
| `runToHalt({ maxTicks })` | For one-shot scripts (Printer Setup, Mars CO2). |

Defaults come from `sim({ maxTicks: 10_000, maxLinesPerRun: 1_000_000 })`. Vitest's wall-clock
`timeout` still applies as a final safety net.

### 4.4 World builder and accessors
```ts
import { describe, it, expect } from "vitest";
import { sim } from "@tasermonkey/ic10-test";

describe("VCCR Cooling Air Management", () => {
  it("pulls in night air when it's cold outside", async () => {
    const world = await sim()
      .network("data")
      .device("vent",   "StructureActiveVent", { TemperatureOutput: 500, PressureOutput: 1000 })
      .device("sensor", "StructureGasSensor",  { Temperature: 300 })
      .housing("ic", {
        file: "ic10/ClimateControl/VCCR Cooling Air Management (1) [22840].ic10",
        pins: { d0: "vent", d1: "sensor" },
      })
      .build();

    await world.runTicks(1);

    expect(world.device("vent")).toHaveProps({ Mode: 1, On: 1 });
    expect(world.chip("ic")).toHaveRegister("OutsideTemp", 300);   // alias → r0
    expect(world.chip("ic")).toHaveNoErrors();
  });
});
```

- A chip's program comes from exactly one of:
  - `file`: a path to an `.ic10` file, resolved from the repo root. Error messages and the debugger
    point at that file.
  - `code`: inline IC10 source as a string. Handy for small harness tests and for trying a snippet:
    ```ts
    .housing("ic", { code: "alias Stage r15\nmove Stage 1\nyield", pins: {} })
    ```
  Passing both, or neither, is a build error. The names match the existing env formats: upstream's
  env JSON uses `code`, and vscode-ic10's uses `file`.
- **Device identity.** Every device, housings included, has three ways to be found:

  | | Used by | Set with |
  |---|---|---|
  | Test-side key, e.g. `"vent"` | The test: `world.device("vent")`, `pins: { d0: "vent" }` | First argument |
  | In-game `name` | `lbn` / `sbn` / `lbns` (name hash) | `{ name: "Coal Chute Low Marker" }` |
  | **Reference ID** | `ld` / `sd`, IDs stored in registers or on the stack, the `ReferenceId` property | `{ id: "$1488" }` or `{ id: 5256 }` |

  These go in an optional fourth argument, so the third stays purely the device's properties (and
  keeps its typing from the catalogue, §6):
  ```ts
  .device("lathe1", "StructureAutolathe", { On: 1 }, { id: "$1488", name: "Autolathe 1" })
  .housing("control", { file: "…/VCIC - Printer Control.ic10", id: "$B0D98" })
  ```
  - IDs accept a number or the game's `$hex` form, exactly as you'd copy it from the tablet.
  - Devices without an `id` get a **deterministic** one from a fixed sequence, so tests and failure
    messages are stable from run to run.
  - Duplicate IDs are a build error.
  - `world.device("lathe1").id` returns it, and failure reports and the debugger show IDs in `$hex`.
  - `ld`/`sd` only find devices on the **housing's data network**, which matches the game and the
    emulator. An unknown ID or a device on another network is an error. The one in-game exception
    is the **Logic Mirror** (§5.4).
  - With more than one network, each device says which one it's on:
    `{ network: "outside" }`. With a single data network, that's the default.
- **Devices the emulator doesn't know** (console-mod parts, `StationBatteryNuclear`) are a build
  error unless marked `{ custom: true }`. A custom device's PrefabHash is `HASH(prefab)`, so batch
  instructions find it by type and name, and it accepts every logic property, readable and
  writable. Phase 5's catalogue can tighten that to the real property lists.
- The chip can live in a device that holds a chip (an AC unit or filtration unit), and then `db` is
  that device.
- **Chips that configure other chips.** A housing can be pinned to another housing, and `put` / `get`
  read and write that chip's stack. This was verified in the spike: `put d0 1 77` from one chip, then
  `get r3 d0 1`, reads back 77, and the target chip's stack holds it. That covers your Printer
  Setup → Printer Control pair:
  ```ts
  it("turns a fabricator off when its power switch is off", async () => {
    const world = await sim()
      .network("data")
      .housing("control", { file: "ic10/FabControl/VCIC - Printer Control.ic10" })
      .housing("setup",   { pins: { d0: "control" }, code: `
          put d0 0 1           # one fabricator
          put d0 1 $1488       # printer
          put d0 2 $3606       # stacker
          put d0 5 $AE87A      # power switch
          # …remaining slots for this fabricator
      ` })
      .device("lathe1",  "StructureAutolathe", {},       { id: "$1488" })
      .device("stacker", "StructureStacker",   {},       { id: "$3606" })
      .device("power",   "ModularDeviceFlipCoverSwitch", { On: 0 }, { id: "$AE87A", custom: true })
      // …
      .build();

    await world.chip("setup").runToHalt({ maxTicks: 1 });          // setup writes the IDs
    expect(world.chip("control")).toHaveStackAt(1, 0x1488);

    await world.runTicks(2);
    expect(world.device("power")).toHaveProps({ Color: 4 });        // Color.Red: switched off
  });
  ```
  The inline `code` setup keeps the test small. Pointing `file` at the real `VCIC - Printer
  Setup.ic10` also works, but then every ID it lists needs a matching device.
- Test-side writes bypass read-only permissions, just as the game updates sensor readings.
- A pin can only be set to a device on the housing's own data network, as in game (the screwdriver
  lists only those). Pinning one on another network is a build error naming both networks
  (2026-10-12). A Logic Mirror (§5.4) is how a chip reaches across.
- Accessors:
  - `chip.reg("Stage" | "r15")`, `.sp`, `.ra`, `.stack(i)`, `.line`, `.errors`, `.halted`;
  - `world.db("ic")`;
  - `world.network("data").byName(...)` / `.byType(...)`;
  - `device.slot(i)`.
- **Snapshots, diffs and history.**
  - `world.snapshot()` / `world.diff(s)` record exactly which device properties and registers changed.
  - `world.record("vent.On")` gives one value per tick, for assertions such as "toggles at most twice in
    20 ticks" (the check that catches the Suit MKII chatter).
- Script loading normalises CRLF line endings, and `World.fromEnv(json)` loads upstream env files.

### 4.5 Errors behave like the game
- Strong and critical errors **halt the chip**: it stops executing and the housing reports the error
  and line. ic10emu sets the housing's `Error` to 1 and leaves the chip's line pointer on the failing line.
  Mirror that, and confirm in game when convenient.
- A halt is **not** an automatic test failure. It's state you assert on:
  ```ts
  expect(world.chip("ic")).toHaveHalted({ line: 57, error: /register/ });   // 0-based: editor line 58
  expect(world.chip("ic")).toHaveNoErrors();     // the usual assertion
  ```
- `sim({ failOnHalt: true })` is available for tests that want any halt to fail immediately.
- **Switching a housing off and on restarts its chip** from line 0, which is also how a halted chip
  gets going again. Another chip does it with:
  ```
  s otherHousing On 0
  yield
  s otherHousing On 1
  ```
  The harness reads a housing's `On` at the start of its chip's turn. While it's 0, the chip is
  skipped. When it's found back at 1, the chip restarts: the halt is cleared, the housing's `Error`
  goes back to 0, and defines and aliases are rebuilt as the script runs again. Switching off and on
  within one turn isn't noticed, which is why the `yield` is needed. Housings start switched on
  unless built with `On: 0`.

  This applies to IC housings only. On other devices that take a chip, `On` is the device's own
  function: a hardsuit's is its A/C ("Controls A/C power for the suit", per the wiki), and the MKII
  suit script switches it off and on while its chip keeps running. An AC unit's `On` is treated the
  same way, which is unconfirmed in game.

  **Answered in game (2026-10-12):** a restart keeps the registers. Powering the housing off and on, and removing the chip and reinserting it, both restart the script at line 0 with the registers unchanged (Audit 01's leftover r0 = NaN was still there in Test A). So the default is right. `restartClearsState: true` stays available for tests that want a clean start. The stack wasn't checked; it is still open.

### 4.6 Matchers (Vitest `expect.extend`)
`toHaveProps`, `toHaveRegister`, `toHaveRegisterCloseTo`, `toHaveStack`, `toHaveStackAt(i, v)`, `toBeAtLine`,
`toHaveNoErrors`, `toHaveHalted`, `toOnlyChange([...])`, `toToggleAtMost(n)`, `toNeverAutoYield`,
`toAutoYieldAtMost`.

Each matcher is backed by a plain function, so the logic isn't tied to Vitest. When a matcher fails,
the report shows the line number and source text, registers with their aliases, the last N executed
lines, auto-yield count, and the relevant device properties.

---

## 5. World behaviour: events, device models, atmospheres

This lets a test dictate what happens in the world while the script runs.

### 5.1 Scripted events
```ts
world.at({ tick: 20 },       w => w.device("sensor").set("Temperature", 450));   // day comes
world.every({ ticks: 10 },   w => w.device("battery").add("Charge", -500));
world.when(w => w.device("door").get("Open") === 1, w => w.room("hangar").merge(w.room("outside").take(50)));
```

### 5.2 Device models
These are per-tick callbacks for how a device reacts to what the script sets. They're plausible, not
physically exact. Each runs at the start of a tick, after scripted events and before chips, so a
setting a script writes acts in the next tick.

```ts
world.model("vent", activeVent());                                 // from the library
world.model(heatExchange("coolant", "waste", { fraction: 0.1 }));  // world-wide: a radiator
world.model("lamp", (lamp, dt, w) => {                             // your own
  if (lamp.get("On")) w.room("base").addHeat(5 * dt);
});
```

The library follows the game's code where it's in `Assembly-CSharp.dll`, with per-prefab rates as
tunable guesses: active and powered vents, heat exchange, volume pump, pressure and back-pressure
regulators, filtration (the filtered gases to the filter output, the rest to waste), AC (moves
heat), battery (charge from generation minus usage), occupancy schedule, the weather timer (a
day/night cycle) and the hydroponics Larre. The harness README lists each one's options.

### 5.3 Atmospheres: pipes and rooms
This covers changing gas ratios and temperature:

```ts
sim()
  .pipe("waste", { volume: 10 * PIPE_VOLUME, temperature: 310,
                   gases: { CarbonDioxide: 40, Nitrogen: 10, Pollutant: 2 } })        // moles
  .room("outside", { temperature: 300, pressure: 20, ratios: { CarbonDioxide: 95 } }) // no volume: outside air
  .device("pa", "StructurePipeAnalysizer", {}, { pipe: "waste" })

world.at({ tick: 5 }, w => w.pipe("waste").add("NitrousOxide", 3).setTemperature(280));
```

- An ideal-gas mixture (P = nRT/V) gives each pipe or room `Pressure`, `Temperature`, `TotalMoles`
  and `Ratio<Gas>`. A room without a volume is outside air, too big to change.
- Devices attached to a pipe or room **derive their port-specific properties automatically**,
  with `{ pipe }`, `{ room }` and `{ ports: { input, input2, output, output2 } }`: `PressureInput`,
  `RatioNitrogenInput`, `TemperatureInput`; `…Input2`; `…Output` / `…Output2`, and so on. A
  filtration unit's `RatioNitrogenInput` follows the pipe's composition. Gas sensors read their
  room. Setting one of those by hand is an error that says to change the gas instead.
- Models (§5.2) move moles and heat between pipes and rooms, which closes the loop. A vent on the
  Alaska cooler really does cool the pipe over N ticks.

### 5.4 Logic Mirror (devices on another network)

From the [wiki](https://stationeers-wiki.com/Logic_I/O#Logic_Mirror): a Logic Mirror sits on one
data network and **stands in for a single target device on another network**. The target is chosen
with a screwdriver. Reads and writes through the mirror act on the target "as if the target device
itself is present in the logic network". It needs power (10 W), and unpowered it returns no data.
Known bug: it doesn't forward `ls` (slot reads).

**The emulator's game data doesn't have this device**, and the Stationpedia export has only its hash
(no logic types), so the harness defines it: a `StructureLogicMirror` whose reads and writes go to
the target. The fork's extension point for that is `DeviceProps.hooks`: when set, an instruction's
`read`, `write`, `canLoad` and `canStore` go through it, while the world's own view (`forceRead`,
`forceWrite`, snapshots) keeps the device's own values. Errors the target raises are moved onto the
mirror, since a chip only collects errors from devices on its own network.

```ts
const world = await sim()
  .network("base")
  .network("outside")
  .device("sensor", "StructureGasSensor", { RatioNitrogen: 0.7 }, { network: "outside" })
  .mirror("mirror", { target: "sensor", network: "base" })        // powered by default
  .housing("ic", { code: "l r0 d0 RatioNitrogen\nyield", network: "base", pins: { d0: "mirror" } })
  .build();

await world.runTicks(1);
expect(world.chip("ic")).toHaveRegister("r0", 0.7);

world.mirror("mirror").setPowered(false);
await world.runTicks(1);
expect(world.chip("ic")).toHaveRegister("r0", 0);                  // unpowered: no data
```

**Behaviour, from the game's code.** The game's `LogicMirror` (read from `Assembly-CSharp.dll`,
2026-10-11) overrides only `CanLogicRead`, `GetLogicValue`, `CanLogicWrite` and `SetLogicValue`,
each passed to its target, and nothing else in the game mentions it. That settles every guess the
plan had (it had a world option for each; they were dropped, 2026-10-11):

| Through the mirror | Game | Why |
|---|---|---|
| `l`/`s` on a pin set to the mirror, and `ld`/`sd` with the **mirror's** reference ID | Passed to the target | The four overrides |
| Mirror unpowered | Reads 0, writes are dropped, no error | Only the value methods check power; the `Can…` checks still pass |
| `ls` / `ss` (slots) | **Halts the chip** (`IncorrectLogicType`) | Slot logic isn't overridden and the mirror has no slots (the wiki's "doesn't forward `ls`" bug) |
| `PrefabHash`, `ReferenceId`, `NameHash` read through it | The target's | They're logic types like any other |
| `lb`/`sb`/`lbn` with the **target's** prefab or name | Not visible: batch ops see a Logic Mirror | They match on the device's own prefab and name hashes. `lb HASH("StructureLogicMirror") …` reads through to the target |
| `ld` with the **target's** own reference ID | Not found (`DeviceNotFound`) | The housing only accepts an ID on its own data network |
| No target set | **Halts the chip** (`IncorrectLogicType`) | With no target the `Can…` checks are false, and `l`/`s` throw |
| A logic type the target lacks, powered or not | Halts the chip, naming both: `"mirror" (…) → "sensor" (…) has no logic type …` | The `Can…` check comes before the power check |

`world.mirror(key)` gives the mirror's handle: `target`, `setTarget(key | undefined)` (a
screwdriver, in game), `powered` and `setPowered`. It has no values of its own, so `get`/`set` on it
throw and point at the target. The debugger (§6b) shows a mirror's target as a row,
`target = sensor (outside)`, that expands to the target device, and whether it's powered.

---

## 6. Device and property catalogue

This makes it easy to see what properties a device has, and to validate that scripts use real ones.

### Data sources
| Source | What it gives | Freshness / licence |
|---|---|---|
| Fork's game data (`assets.ic10.dev`, via `tools/download.ts`) | Per prefab: logic types with Read/Write, slots and their logic types, modes, connections. | Kept current by the fork's download tool. |
| **Your game install:** `…/Stationeers/rocketstation_Data/StreamingAssets/Language/english.xml` | **Descriptions:** 287 `LogicType…` records, e.g. `LogicTypeRatioNitrogenInput` → "The ratio of nitrogen in device's input network". It also has slot types and device descriptions. | Always matches your game version (file dated 2026-08-22). It's game text owned by RocketWerkz, so **extract at build time and gitignore the output**; don't commit it. |
| **Stationpedia export** ([Ryex/StationeersStationpediaExtractor](https://github.com/Ryex/StationeersStationpediaExtractor), a BepInEx plugin; `stationpedia_export` in the F3 console writes `Stationpedia/Enums.json` and `Stationpedia.json`) | A description for every logic type, and each loaded prefab's logic types and slots, possibly including mods' devices. | Your game version, whenever you run it. Game data: the descriptions stay local; mod devices' names and Read/Write go into committed `ic10-test/data/mods/`. |
| [Stationeers wiki](https://stationeers-wiki.com/Filtration) device pages | **Per-device**, human-written descriptions with units and ranges, e.g. Filtration → `RatioNitrogenInput`: "Percentage of Nitrogen in input as ratio between 0 and 1". Richer than the game's generic one-liners. | Community-maintained: some entries are "Unknown", a few disagree with other pages or the game, and some may lag game updates. The site's Cloudflare bot check blocks scripted access. **Licensed CC BY-SA and GFDL** (from the site's disclaimer). |

A `catalog:build` script merges these into `ic10-test/generated/catalog.json`. It finds the game
through `STATIONEERS_DIR` or the default Steam path. Without the game or an export (e.g. in CI)
there are no descriptions; types and Read/Write checks work the same.

ic10emu's descriptions were used as a fallback in step 1, then dropped: they're an older run of the
same Stationpedia export (ic10emu's `xtask generate` reads `Enums.json` and `Stationpedia.json`).

**Working from a clean clone** needs neither the mod nor an export: `npm install`, then `npm test`.
The committed fork data and `data/mods/` give every type. **Refreshing** after a game update or a
new mod: run the export in game, then `npm run catalog:import-stationpedia` to regenerate `data/mods/`,
and commit it. Whoever has an export locally also gets its descriptions in their build.

**How descriptions combine.** The catalogue keeps every source's text with a source label instead of
picking one winner:

```
RatioNitrogenInput   (StructureFiltration)   Read
  wiki: Percentage of Nitrogen in input as ratio between 0 and 1
  game: The ratio of nitrogen in device's input network
```

- The **game and fork data decide** which properties exist and their Read/Write permissions, because
  they match the installed game version.
- **Wiki text is shown first** in hovers and the CLI when present, because it's per-device and
  includes units and ranges. Game text is shown alongside it, and game text is used alone when the
  wiki has nothing.
- If the wiki lists a property the game data doesn't have, or the reverse, `catalog:build` prints a
  warning. That's a cheap way to spot stale wiki entries or renamed properties.

**Getting wiki data without scraping.** We respect the bot check rather than work around it:

1. **Manual export (start here).** In a browser, use the wiki's `Special:Export` page to export the
   device pages you care about as one XML file. Drop it in `ic10-test/data/wiki/`, which may be
   committed under the licence rules below. `catalog:build` parses the device parameter tables from
   the page source.
2. Do this per device as you write tests. It doesn't need to be complete, because game text covers
   the gaps.
3. If the wiki offers a supported dump or API access later, swap that in.

**Licence handling.** The wiki's disclaimer grants a licence to copy under **CC BY-SA and GFDL**.
We follow CC BY-SA, the simpler of the two:

- **Committing wiki text is allowed**, as long as it stays in its own data directory,
  `ic10-test/data/wiki/`, with its own licence. It's never mixed into code files.
  - `LICENSE`: CC BY-SA, at the version shown in the wiki footer. Version matters: 4.0 is one-way
    compatible with GPLv3, but 3.0 isn't. Keeping the data separately licensed avoids depending on
    that.
  - `ATTRIBUTION.md`, generated by `catalog:build`, lists for each page: page title, URL, revision
    ID, retrieval date, a link to the page history (which credits the authors), and the licence. A
    `Special:Export` file already contains page titles and revision IDs, so this can be automatic.
  - Share-alike: the extracted descriptions file is an adaptation of the wiki text, so it carries
    CC BY-SA too. The harness code that *reads* it stays AGPL. That's an aggregate of separately
    licensed parts, not a merged work.
- **Show attribution in the UI**: hovers and the CLI label wiki text `(Stationeers wiki, CC BY-SA)`.
- **Caveats from the disclaimer:**
  - The wiki can't license material it doesn't own. Some wiki descriptions may be copied from the
    game, which is RocketWerkz text. That's low-risk for descriptive data used for reference, but
    it's a reason not to bulk-commit every page "just because."
  - "Stationeers" is a trademark, so we don't name the harness in a way that implies endorsement.
    Describing it as "for the game Stationeers" is fine.

### Uses
1. **Typed, documented builders.** Generate a `.d.ts` per prefab so this autocompletes, and hovering
   a property shows its description and Read/Write:
   ```ts
   .device("filter", "StructureFiltration", { RatioNitrogenInput: 0.7 })
   ```
   A typo or a property that doesn't exist on that device becomes a **compile error** in the test.
2. **Runtime validation.** When a script reads or writes a property the device doesn't have, or
   writes a read-only one, it's reported with the line number. The emulator already enforces
   permissions; the harness surfaces it clearly.
3. **Static validation, no test needed.** For `lb`/`sb`/`lbn`/`sbn`/`lbs`/`lbns`/`sbs` whose device
   type is a known prefab (`HASH("StructureX")`, a hash number, or a define of either), check that
   the property exists on that prefab and has the right permission. This was first said to flag
   review item 1.4, but it can't: 1.4 read through a pin (`l`), whose device a static check can't
   know, and `PressureInternal` is a real, readable vent property; the bug was reading a setting
   where a measurement was meant, which the catalogue can't tell apart.
4. **A CLI lookup:** `npx ic10-test props StructureFiltration` prints a table of name, R/W and
   description.

---

## 6b. VS Code debugger: step through IC10 while a test runs

VS Code supports custom-language debugging through the **Debug Adapter Protocol (DAP)**. The harness
runs IC10 one line at a time through an `async` step, so pausing before any line is a matter of
awaiting until the debugger says "continue."

### Prior art
[Stationeers-ic/vscode-ic10](https://github.com/Stationeers-ic/vscode-ic10) (GPL-3.0, updated
2026-08) already has a DAP debugger with:
- breakpoints and conditional breakpoints;
- step over, step in and step out;
- one thread per chip;
- variable scopes for Registers, Devices, Aliases, Defines, Stack and Network;
- hover evaluation.

It launches from an `.ic10` file plus a `.ic.json` env file. However, it runs on the npm package, so
it has the same engine gaps (§2): no ticks, real-time `sleep`, and the jump limit. Its debugger would
show different behaviour from what our tests see.

GPL-3.0 code can be combined with AGPL-3.0 (GPLv3 §13), so we could have reused its pieces. In the
end none was copied (see the decisions below): its adapter has no real pause, keeps breakpoints
globally and treats all three steps alike, and your installed IC10 extension already provides the
grammar. Only its scope layout was kept. The **engine underneath is our harness `World`**, so
debugging and testing behave identically.

### Decisions (Phase 7, 2026-10-11)
| Question | Decision |
|---|---|
| Where the adapter runs | In the extension, inline (`ic10-test-vscode/src/adapter.ts`, no `vscode` import, so `DebugClient` tests it without an editor). A small **agent** in the test process connects back over a socket. |
| Who decides where to stop | The agent, in the test process. A run doesn't wait on the adapter for every line, and lets messages in every few milliseconds so Pause works. |
| Where the extension lives | `ic10-test-vscode/`, a sibling of `ic10-test/` with its own package and LICENSE. It shares only the protocol's types and version (`@tasermonkey/ic10-test/debug-protocol`), so either can move to its own repo. |
| Grammar | None: your IC10 extension (florpydorp) provides the `ic10` language. Ours declares the language and its breakpoints only. |
| Code from vscode-ic10 | None. Only its scope layout. |
| Distribution | A local `.vsix` (`npm run vscode:package -w ic10-test-vscode`), publisher `tasermonkey`, the repo as homepage. |
| Sessions | Each launch is its own session; a new one doesn't stop the last. |
| Call Stack | A frame per `jal` or branch-and-link call: the stack is the call stack, as in assembly. Step Over and Step Out go by that depth. |
| CodeLens | Above `it`, `test` and `describe` in TypeScript and JavaScript, only in a workspace with IC10 in it; the setting `ic10-test.codeLens` turns it off. |
| Debugging the TypeScript too | A launch attribute `debugTypeScript` and a setting `ic10-test.debugTypeScript` (off by default), not a second CodeLens. The JavaScript debugger runs as a child session; stopping either ends both. |
| Scenarios | A world module (`x.world.ts`) or env JSON plus a `program`. Run under plain Node, as fast as it can, ending once every chip has stopped and nothing is due. Started by a launch configuration, F5, or an editor-title button; an `.ic10` stands for the scenario beside it. |
| Step back | Not in Phase 7 (see Controls). |

### How it hooks into tests
```
VS Code ──DAP──▶ ic10-test debug adapter ──socket──▶ harness inside a Vitest test process
                 (in the VS Code extension             or a scenario run under Node
                  ic10-test-vscode/)                   (the agent is the scheduler's "debug
                                                         gate" when IC10_DEBUG is set)
```
- **Launch from a test.** A CodeLens "▶ Debug IC10" appears above each `it(...)`, and there's a
  launch config of `{ "type": "ic10-test", "test": "tests/…/x.test.ts", "line": 27 }`.
  The adapter starts Vitest for that one test with `IC10_DEBUG=<port>` and no timeout. The
  harness connects back, and execution pauses at breakpoints set in the `.ic10` file.
- **Debug both together.** With `"debugTypeScript": true` (or the setting), the extension starts the
  test under VS Code's JavaScript debugger as a child of the IC10 session, so you can break in the
  TypeScript test *and* step through the IC10 script. (The plan first said a compound launch
  config; that would start two processes, not attach to one.)
- **Launch from a scenario.** Point the debugger at a world module (`x.world.ts`), or env JSON plus
  the `.ic10` a chip runs, for exploring without a test. An `.ic10` with a world beside it works
  too.

### What you see while paused
| Feature | Details |
|---|---|
| **Registers** | `r15 (Stage) = 1`, with aliases shown next to raw names; `sp` and `ra`. Values are editable (`setVariable`). |
| **Stack** | Entries `0…sp`, with the TOS marked. |
| **Devices** | Grouped by pin (`d0 → vent`), then `db`, then other network devices. Each shows its props, slots, name and reference ID (`$1488`). When a register or stack value matches a device's reference ID, it's labelled with that device (`r1 = 5256 → lathe1`). Hovers show the description and Read/Write from the catalogue (§6). Values are editable mid-pause. |
| **Atmospheres** | Pipes and rooms: pressure, temperature, moles and ratio per gas. |
| **World** | Tick, game time, lines used this tick (out of 128), auto-yield count, sleep state, and pending scheduled events. |
| **Inline values** | Current register and device values drawn next to the source lines, like JS debugging. |

### Controls
- Standard controls: **Step Over** (one line; `jal` treated as a call), **Step Into**, **Step Out**
  (to the `j ra`), and **Continue**.
- Extra harness commands as toolbar buttons or the command palette: **Step Tick** (run to the next
  yield or auto-yield), **Run N Ticks**, and **Run Until Event**.
- **Data breakpoints**: right-click a variable and choose "Break on Value Change", e.g. stop when
  `vent.On` or `Stage` changes.
- **Break on halt**: IC10 errors appear as exception stops, e.g. "Halted: invalid register at line
  58". This is toggled in the Breakpoints panel.
- **Break on auto-yield** (optional): stops when a chip is preempted at 128 lines.
- **Step back (Phase 8)**: this first said the harness already snapshots state each tick, so DAP's
  step-back and reverse-continue could rewind a tick. That was wrong. `snapshot()` is taken on
  demand, not each tick, and records registers, device properties and readings as numbers for
  `diff()` and reports; it has no restore. It leaves out slots, the stack, the line each chip is on,
  its defines and calls, sleeps, scheduled events and models' state. Rewinding
  needs a full save and restore of the world (or replaying from the start to a tick, since runs are
  deterministic), so it moves to Phase 8.

---

## 7. Phases

| Phase | Work | Done when |
|---|---|---|
| **0 Fork and toolchain** | Fork on GitHub (needs your go-ahead when we get there) and add it as a submodule. Convert to Node 24, npm and Vitest. Run the ESM codemod and convert enums. | The fork's own test suite passes under `npx vitest`. `node -e "import('…/dist/index.js')"` works. |
| **1 Engine fixes** | Suspend signal, `define 0`, `ld`/`sd` by reference ID, errors never escaping `step()`, sandbox and i18n initialisation. | The 38-script sweep is 38/38. A `sleep 5` test advances 10 virtual ticks with no real delay. |
| **2 Harness core** | Workspace layout, engine adapter, World builder, tick scheduler with 128-line auto-yield, budgets, halt-on-error, accessors with aliases, snapshots and history. Scripted events (§5.1) and the debug gate (§6b) start here too, since later phases depend on them. | The VCCR test in §4.4 passes. An infinite `runUntil` fails with a trace in milliseconds. |
| **3 Matchers and reports** | §4.6, including the auto-yield matchers and failure reports. | Failure output is readable without a debugger. |
| **4 Tests for your scripts** | Write failing regression tests for [CODE_REVIEW.md](CODE_REVIEW.md) §1 first, then fix the scripts. Then add behaviour tests for the simpler scripts. | The review bugs are covered and fixed. |
| **5 Catalogue** | §6 sources (game, fork data, Stationpedia export, wiki `Special:Export` import), generated `.d.ts`, CLI lookup, runtime surfacing, static batch-op checks. | Mistyped properties in tests fail to compile, and every script's batch instructions are checked against the catalogue. (Originally "1.4-style misuse is flagged", which a catalogue check can't do; see §6.) |
| **6 World behaviour** | §5 model library, pipe and room atmospheres, and the Logic Mirror proxy device (§5.4). | An Alaska Cooler test cools a pipe over N ticks through the vent model. |
| **7 VS Code debugger** | §6b. Build the adapter and a small extension in `ic10-test-vscode/` (first planned as `ic10-test/vscode/`, reusing vscode-ic10's grammar and adapter pieces; see §6b's decisions). Add the CodeLens on tests and the scopes from the table. | Breakpoint in an `.ic10` file, "Debug IC10" on a test, step line by line, and watch registers and `vent.On` change. |
| **8 Later** | Lint rules (unused defines, relative branches landing on labels, double aliasing), the preemption sweep, the debugger's step back (a full save and restore of a world; §6b), phase changes in the gas core (condensing and boiling from the game's per-gas curves, with latent heat; e.g. an Alaska coolant pipe left full in the cold), and extracting `ic10-test/` to its own repo. | — |

**Status (2026-10-08):**
- **Phase 0 is done.** The fork has been converted (CI passes). The root npm workspace uses
  `vitest.config.ts` and resolves the fork's TypeScript sources through a `source` export
  condition, so there's no build step. The first VCCR test and the script sweep are in `tests/`.
  The `ic10-test/` workspace package (`@tasermonkey/ic10-test`) exists, with `createEnv`,
  `readScript` and `findScripts` and its own tests. Phase 2's `sim()` builder builds on
  `createEnv`. Paths specific to this repo are in `tests/support/paths.ts`.
- **Phase 1 is done:** G6, G10, the suspend signal (G1/G2, fork side), G11, and i18n defaulting
  to English. The sweep is 37/38; the one failure is Alaska's real `move stage 0` bug. G5
  (undefined identifiers) stays optional and moves to the Phase 8 lint.
- **Phase 2 is done**, apart from `World.fromEnv(json)`, which moves to Phase 3. `ic10-test/` has:
  - `sim()` with `file:` / `code:` programs, devices by key, and `{ id, name, network }` options.
    IDs come from a deterministic sequence starting at `$1001`.
  - The tick scheduler: 128 lines per tick, then an automatic yield; `countNonInstructionLines`;
    per-chip overrides; `sleep` on a virtual clock.
  - Run controls with `maxTicks` / `maxLinesPerRun` budgets. A failing run reports every chip's state
    and the last 20 lines. An endless `runUntil` on a yielding loop fails in about 0.1 s; a loop with
    no yield hits the line budget after about 3 s, at roughly 3 µs per line.
  - Halt-on-error: strong or critical errors, with the housing's `Error` set to 1, and `failOnHalt`.
  - Register accessors that resolve aliases; snapshots and diffs; `record()`.
  - Scripted events: `at`, `every`, `when`.
  - The debug gate (`sim({ debug })`, `setDefaultDebugGate`).

  Line numbers in the API are **0-based**, like the game's `LineNumber`. The VCCR test is in the §4.4
  style, plus a day-comes test that found G13.
- **Phase 3 is done (2026-10-08).** All twelve §4.6 matchers are in `ic10-test/src/matchers/vitest-setup.ts`, loaded
  through `setupFiles`. Each is backed by a plain `check*` function in `src/matchers/checks.ts`.
  Details settled while building them:
  - `toHaveNoErrors()` counts **warnings and above** by default. That included reading a property
    the device doesn't have, which the emulator recorded as a warning without halting (it halts
    since G18, as in game).
    `{ severity }` changes the threshold.
  - `toOnlyChange` takes a world with `{ since: snapshot }`, or `world.diff(...)`. It accepts aliases
    and `*`, and ignores a housing's `LineNumber`, which the emulator updates on every line.
  - `toHaveProps` also accepts a chip, meaning its housing (`db`). Asymmetric matchers work.
  - A failure report shows the chip's status and source line, registers with aliases (values that
    are reference IDs are labelled with their device), the stack, the devices on its pins and `db`,
    and its last lines. Auto-yield failures also list where the chip was preempted and in which ticks.
  - `World.fromEnv(env)` takes an object, JSON text or a file path. Devices are keyed by unique
    `name`, otherwise by `$hex` ID, or by `{ testKeysById }`. Chips keep their starting registers and stack.

  The VCCR test now uses the matchers.
- **Phase 4 is in progress.** Regression tests were written first and failed, then the scripts were
  fixed, for 1.1 (Alaska), 1.4 (Cooling Air Mgmt), 1.5 (CoolCleanMarsAir) and 1.6 (Suit MKII
  chatter; the fix also corrects the 1.7 branch offset). The script sweep is now 38/38.
  1.9, 1.10 and the FabControl pair needed console-mod devices (`ModularDevice*`) and
  `StationBatteryNuclear`, which aren't in the emulator's device catalogue, so `sim()` now takes
  **custom devices** (`{ custom: true }`, §4.4). The harness registers their hashes with the
  emulator, which otherwise rejects an unknown hash in `lb` / `sb`. With them (2026-10-09):
  - 1.9 Battery Controller 1 and 1.10 Trader Vert: failing tests first, then the fixes.
  - FabControl: behaviour tests with the real setup chip and devices at its hard-coded IDs. They
    passed as written; swapping the light colours or the button offset in Control makes them fail.
  - Behaviour tests for the Trader Vert buttons and numpad.
  - The rest of review §1, with your decisions:
    - 1.2 Alaska: the defines are now kelvin with °C comments (`MIN_TEMP 290 # 17C`,
      `MAX_TEMP 303 # 30C`), and the code uses them. Behaviour is unchanged; a test pins the thresholds.
    - 1.8 Suit MKI and MKII: failing tests first, then the helmet opens only when the outside pressure
      is between 40 and 150 kPa and the temperature between 280 and 313 K, and closes when that stops
      being true, including during the 5 s wait.
    - 1.11 and 1.12, the mixers: the housing shows `Status` (1 mixing, 0 off, NaN for missing devices)
      in all three mixer scripts, and the N-CO2 mixer's second input is the CO₂ (2/3 N₂, 1/3 CO₂,
      kept). The 1.11 test needed engine gap G14 fixed.
    - Tanks no longer have logic in the current game (a tank just adds volume to its pipe network),
      so the air mixers now read pipe analyzers: "PA Nitrogen", "PA CO2", "PA O2" and
      "PA Breathable Air", alongside the existing "PA N-CO2".
    - 1.3 (Alaska vent modes) still needs an in-game check. (Settled in Phase 6 from the
      Stationpedia text, and fixed.)

  - Behaviour tests for the short scripts (60 lines or fewer): Mars CO2, Grow Lights, Filter
    Controller MKI, Nitrice Crusher (its chip is in a filtration unit), Cold Night Extraction, the
    five room EControl scripts, Dock Occupied, Weather, Arc Furnace, Food Machine Selector and Larree
    Debug. They describe what the scripts do today, except where a review §2 issue was then fixed
    after a failing test: 2.6 (Arc Furnace switched off mid-smelt) and 2.8 (Food Selector dial past
    the item table). Two small tidies too: Weather's dead `seq` line, and duplicate light pushes in
    the room scripts. They needed engine gaps G15 and G16 fixed, and two harness
    additions: `device.slot(i)` (put items in slots for `ls`) and `device.stackAt(i)` (a device's
    own memory), plus `hash(name)`.
  - Weather's warning light (d1) is a Diode in the test. Only the Diode, the console LEDs and the
    Beacon have `Color` logic; ordinary lights, the Flashing Light included, are paint-only. In the
    game code, `Device.CanLogicRead` allows `Color` only when the prefab's `HasColorState` is set.

  - Behaviour tests for the longer scripts (2026-10-10), so every script in `ic10/` now has a test:
    Trader Horz Input (sharing `trader-input.ts` with Vert), Trading Switch Board, Landing Bay, Sat
    Control, Power Controller Battery, Battery Control and Battery Controller 1 (sharing `power.ts`,
    one `describe*` per feature), MBA Solar Power Controller, Larre Controller (with a small Larre
    model in the test until Phase 6), and the workshop scripts V-IC Hash and V-IC - Furnace, tested
    from the outside. Fixed after failing tests, with your decisions: review 2.2 (Landing Bay counts
    up to `EMPTY_KPA` 1 kPa as empty), 2.4 (the generators follow the charging state on every pass,
    so they start on when the battery is low) and 2.7 (Larre harvests only mature plants and gives
    up after 5 tries). Two Landing Bay bugs that weren't in the review were fixed as well: a startup
    branch that left the stage at 0 when the door was open, and a line that switched GoodVent off
    on every pass. `EXT_KPA` stays a per-world define.
  - Device notes: StructureLogicSwitch2 has no `On`, so the Trading Switch Board's dock switches
    are custom console switches in the test. The emulator's `mod` is a true modulo (−1 mod 360 =
    359), as the wiki says. V-IC - Furnace unpacks iron's maximum pressure as 9921, not 10000,
    because of double rounding in the workshop script's packing; the game should do the same, and
    the test pins 9921.

- **Phase 4 is done (2026-10-10).** The §1 review bugs are covered and fixed, apart from 1.3 (Alaska
  vent modes), which needs an in-game check (fixed in Phase 6). Afterwards, also test-first: review 2.5 (Battery
  Control and Battery Controller 1 read only "Base CA") and 2.2 in CoolCleanMarsAir and Alaska
  (`EMPTY_KPA`). Then the rest of §2: 2.10 (Suit MKII stops heating and cooling at the setting),
  and 2.9, which turned out to be missed presses rather than repeated ones. A button press is a
  one-tick pulse, and Printer Control read one fabricator's buttons per tick; it now batch-checks
  the round buttons every tick and scans them all on a press. 2.1 is left as is: the only jump of
  5 or more lines is in Suit MKII, which is over the line limit. All of review §2 is dealt with.
  Next is Phase 5, the catalogue (§6).

- **Phase 5 (2026-10-10 to 11).** Decisions: the generated catalogue is gitignored and
  built before `npm test` and `npm run typecheck`; mods' devices get their properties from the
  Stationpedia export (or the mod's DLL if the export leaves them out), committed to `data/mods/`;
  the wiki import is deferred. Steps: 1 `catalog:build`, 2 typed builder, 3 static batch-op check,
  4 CLI, 5 runtime messages.
  - Step 1 is done: `catalog:build` writes `ic10-test/generated/catalog.json` from the fork's 407
    prefabs and the game's `english.xml`. ic10emu's descriptions were tried as a fallback and
    dropped, since they come from the same export.
  - The Stationpedia export (game 0.2.6428.27798) includes mods' devices. `npm run
    catalog:import-stationpedia` wrote the 130 prefabs with logic that the fork's data lacks (all 56
    console parts, `StationBatteryNuclear`, Mirrored Devices, FPGA, terminals, circuit breakers) to
    committed `ic10-test/data/mods/prefabs.json`, so the DLL isn't needed. `catalog:build` now has
    537 prefabs and takes descriptions from the export's `Enums.json`, then `english.xml`; all 366
    logic types are described. The export also shows 10 game prefabs with extra logic types the
    fork's data lacks (batteries: `ImportQuantity`, `ExportQuantity`; transformers: `PowerActual`),
    from a newer game version or a power mod. The catalogue keeps the fork's for now.
  - Step 2 is done. At runtime, `sim()` adds each prefab in `data/mods/prefabs.json` to the
    emulator's device table, so mods' devices have exactly their own properties with the game's
    Read/Write (a script writing one they lack halts, as in game). Game prefabs with data but no
    device class (`Landingpad_DataConnectionPiece`) are built the same way. `custom: true` is now only
    for prefabs in neither, and the script tests no longer use it. That found a wrong guess in the
    Printer Control test: its power input is a Light Diode (`ModularDeviceLight`), since the
    flip-cover switch it used has no `Color`. At compile time, `catalog:build` also writes
    `generated/prefab-props.ts`, so `sim().device()` and `.housing()` props are type-checked, with
    descriptions in hovers; `ic10-test/test/prefab-props.typecheck.ts` pins that typos fail.
  - Step 3 is done: `checkBatchOps` (`ic10-test/src/lint/`) and `tests/scripts-batch-ops.test.ts`,
    which runs it over every script. It checks 263 of the 286 batch instructions (the other 23 take
    their device type from a register) and finds nothing, in the current scripts and in the
    originals before Phase 4. It guards new code; it couldn't have caught review 1.4 (see §6).
  - Step 4 is done: `npx ic10-test props <prefab | words | hash>` and `npx ic10-test logic <name>`
    (`ic10-test/bin/ic10-test.ts`, building the catalogue if it's missing). The catalogue now strips
    the game's rich-text tags (`<link=…><color=…>`) from descriptions, for hovers too.
  - Step 5 is done: the emulator's property errors ("Device -236516384 property 38 not found") are
    rewritten as they're recorded, naming the device by test key, prefab and reference ID, and
    listing what it has (`"switch" (ModularDeviceFlipCoverSwitch $AE87A) has no logic type Color;
    it has …`, `… can't write Ratio: it's read-only; writable: Lock, On`).

- **Phase 5 is done (2026-10-11).** Deferred: the wiki import (§6), and typing property names on
  handles after `build()` (`world.device("vent").set(…)`, `toHaveProps`), which would need the
  builder to remember each key's prefab. Next is Phase 6, world behaviour (§5).

- **Phase 6 (from 2026-10-11).** Decisions:
  - Heat: mixing and heat transfer use each gas's specific heat from the game, read once from
    `Assembly-CSharp.dll` and committed as a small table.
  - A device attached to a pipe or room reads its port values (`Pressure`, `PressureOutput`,
    `RatioNitrogenInput`, …) from that atmosphere. Setting one of them on the device by hand is an
    error that says to change the pipe instead. Devices with nothing attached work as before.
  - Models are plausible, with rates a test can tune; defaults come from the game's DLL where
    they're easy to find.
  - Tests that move to atmospheres: Alaska, CoolCleanMarsAir, both Cooling Air Management scripts
    and Cold Night Extraction. The rest keep setting values by hand.
  - The Larre model moves into the shared library, rebuilt on the model API, with its guesses
    written down.
  - Order: 1.3 fix, the gas core, pipes and rooms in the world, the model API, vents and a heat
    exchange model (then the Alaska test), the rest of the library, the Larre model, the climate
    tests on pipes and rooms, the Logic Mirror, docs.
  - The Stationpedia export has `StructureLogicMirror` (a real hash, no logic types, no
    description), so §5.4's "neither source has it" only holds for the fork's data.
  - Review 1.3 (Alaska vent modes) is fixed. It was settled by the game's Stationpedia text for the
    Active Vent ("'Outward' … pump gas into a space; 'Inward' … pump gas out"; Mode 0 Outward,
    1 Inward), with no in-game check needed. Cooling now draws outside air into the coolant pipe
    (Mode 1), and stopping empties it back outside (Mode 0). Two tests failed first.
  - The gas core is done (`ic10-test/src/atmos/`): `Mixture` (a pipe or sealed room),
    `Reservoir` (outside air too big to change) and `exchangeHeat`. From the game's DLL: each
    gas's specific heat (`Chemistry.SpecificHeat`), R = 8.3144, a pipe segment 10 L, a grid cell
    8000 L, one atmosphere 101.325 kPa. The 28 gases match the catalogue's `Ratio<Gas>` logic
    types one for one, and a test pins that. Liquids count toward moles and ratios, not pressure.
    Gases don't change phase yet, unlike in game; that moves to Phase 8 (your decision).
  - Step 3 is done: pipes and rooms in the world. `sim().pipe(key, …)` and `.room(key, …)` (a room
    without a volume is outside air). Devices attach with `{ pipe }`, `{ room }` and
    `{ ports: { input, input2, output, output2 } }`, named by the readings' suffix rather than the
    game's port names (a filtration unit's "Pipe Waste" gives `…Output2`). Attached devices get
    `Pressure`, `Temperature`, `TotalMoles`, `Ratio<Gas>` (and a pipe analyzer's `Volume`) from
    their atmospheres at the start of every tick, after scripted events; setting one by hand is an
    error. A room's `TotalMoles` is per grid cell, as a gas sensor reads its cell. `Combustion` and
    `VolumeOfLiquid` aren't modelled. Atmospheres show in `value`/`record` paths
    (`coolant.Temperature`), snapshots and failure reports.
  - Step 4 is done: `world.model(key, (device, dt, world) => …)` and `world.model((dt, world) => …)`
    run each tick after scripted events, before readings refresh and chips run, so a script's
    setting acts in the next tick. An error names the model; `runUntil` keeps going while models
    exist.
  - Step 5 is done, and with it Phase 6's "done when": `activeVent()`, `poweredVent()` and
    `heatExchange()`. The vents follow the game's `ActiveVent` and `PoweredVent` code (read from the
    DLL): Outward fills the room up to `PressureExternal` without taking the pipe below
    `PressureInternal`; Inward the reverse; changing `Mode` resets both to that mode's defaults
    (Outward 101.325 / 0 kPa, Inward 0 / 50,662.5); the powered vent has no pipe-side limit. Their
    flow per tick is a field in the game's asset files, not the DLL, so it's a tunable guess (10 and
    50 kPa of a grid cell). The new Alaska tests build the furnace pipe, coolant pipe, outside air
    and a radiator: the gas cools below 290 K in under 60 ticks, then the coolant pipe drains to
    ≤ 1 kPa and the vent goes off. With the pre-1.3 script both fail.
  - The rest of the library, decided 2026-10-11: the battery takes its generation and usage from
    named devices, `"key.Prop"` paths, numbers or functions (no cable networks); the weather timer
    is a day/night cycle; pumps, filtration and the occupancy schedule are built now although no
    script uses them yet; the vents' flow guesses (10 and 50 kPa) stay.
  - Step 6 is done: `volumePump`, `pressureRegulator`, `backPressureRegulator`, `filtration`,
    `airConditioner`, `battery`, `dayNight` and `occupancySchedule`, each with tests. From the DLL:
    the volume pump moves `Setting` litres of the input a tick, against any pressure (`Setting`
    caps at 10); the regulators move at least `pressurePerTick` kPa of a 10 L segment, or a quarter
    of what would even the pipes out (`AtmosphereHelper.MoveRegulatedGas`); filtration draws more
    the higher the input is above both outputs, up to a third of the 60,795 kPa pipe limit, and
    takes a filtered gas's liquid form and its last trace in the input; the AC passes 100 L of input
    gas a tick at `pressurePerTick` and moves up to 14 kJ with the waste pipe, and only while
    `Mode` is 1 and the input is 1 K or more from `Setting`; filtration and the AC need `Mode` set
    (the unit's button, in game); the battery's charge states and its 10 J/tick loss; the game's
    day is 1200 s. Code defaults stand in for per-prefab asset values: `pressurePerTick` 101.325
    kPa (the vents keep their own guesses). Guesses, tunable: the AC's temperature differential
    and operational temperature efficiency curves, and the daylight sensor's angle conventions.
    The game's filtration sends the **filtered** gas to Pipe Output (`…Output`) and the rest to
    Pipe Waste (`…Output2`), so the model does too (its Stationpedia page agrees). Devices with no
    pipe readings (pumps, regulators) now take pipes on their ports.
  - Step 7 is done: `larreDock()` (`ic10-test/src/models/larre.ts`), following the game's
    `RoboticArmDockHydroponics`. It returns the model and state for the test (`visited`,
    `delivered`, `hand`, `extra`, `planter(n)`). From the DLL: stations are rail junctions numbered
    from the starting dock (0); `Setting` clamps to the rail (wraps on a loop) as it's written; the
    arm moves 1 rail node a second (the code's `_moveSpeed`); `Activate` is ignored while moving,
    and otherwise runs arm down 1 s, act, 0.2 s, arm up 1 s, `Idle` 0 throughout; each Activate
    takes **one** item from a plant (seeds first, then fruit), slot 1 being where the hand's item
    goes to make room, not a seed hopper; an empty hand destroys a plant with nothing to take; a
    drop-off moves the whole hand into an open import bin with an empty input; slot 255 shows the
    plant at the arm (`Seeding` -1 not seeding, 0 no seeds left, 1 seeds to take); `PositionX` is
    the station (-1 while moving). Guesses, tunable: rail nodes between stations (default 1, so 2
    ticks a station; a test sets the gaps), the prefab's speed, stack size 50. Plants don't grow:
    the test sets their seed and fruit counts (your decision, 2026-10-11). Larre Controller's tests
    run on it, with one new test (a plant with more than `HARVEST_TRIES` items). It found review
    2.11: when a harvest was cut short by `HARVEST_TRIES`, the seeds went down the chute and the
    planter was left empty. Fixed after a failing test: the script goes back for the rest of a
    plant that gave something on that visit.
  - Step 8 is done: the climate tests on pipes and rooms, each in a "with gas" block beside the
    logic-only tests, which stay. CoolCleanMarsAir: the AC (holding the chip) cools a loop of base
    air into the coolant pipe, which the vent fills from Mars-like outside air and drains when
    warm; the base air reaches the setpoint over several drain cycles, and the AC is never on while
    the coolant is under 200 kPa or over 293 K. VC-IC Cooling Air Management: a hot pipe is
    expelled to about 500 kPa and left there, and a radiator cooling it below 146 °C stops the
    vent first. VCCR Cooling Air Management and Cold Night Extraction share
    `tests/ClimateControl/night-air.ts`: over a short day/night cycle the pipe fills at night,
    holds in the morning, is expelled once above 453 K, and fills again the next night. The
    planet numbers are illustrative. Seen on the way, not asserted: with the vent rate guess, the
    5 s check lets the Cooling Air Management vent run past the 500 kPa floor (a small pipe
    empties), and CoolCleanMarsAir's fill overshoots 2,500 kPa; the vents' own `PressureInternal`
    would stop both exactly (CoolCleanMarsAir has that line commented out). Your decision: both
    are fine as they are (the floor is only a rough reserve, and the coolant is backed by a tank);
    each script has a comment saying so.
  - The Logic Mirror is done (§5.4). The game's `LogicMirror` code, read from the DLL, settled
    every guess in §5.4's table. Two guesses were wrong: `ls` and a mirror with no target both halt
    the chip rather than read 0. So the five world options were dropped (your decision), and the
    harness follows the game. Fork: `DeviceProps.hooks` (instructions' reads and writes go through
    it), with tests. Harness: `sim().mirror(key, { target, network, powered })`, `world.mirror(key)`
    with `setTarget` and `setPowered`, errors that name both devices (`"mirror" (…) → "sensor"
    (…)`), and `ic10-test/test/mirror.test.ts`. No script in `ic10/` uses a mirror yet. Reading the
    DLL also found G18: reading a logic type a device can't read was only a warning, where the game
    halts the chip. Fixed in the fork (your decision); no script test changed, so no script did it.
  - Docs: §5.1–5.3 now show the API as built (they were the first design sketches), G8 is marked
    done, CODE_REVIEW.md's caveat says what was settled from the game's text and code, and the
    harness README tells mods' mirror-image layouts apart from the Logic Mirror.

- **Phase 6 is done (2026-10-11).** Pipes and rooms, the model API and library (Larre included),
  the climate tests on them, and the Logic Mirror. Deferred to Phase 8: phase changes in the gas
  core. Next is Phase 7, the VS Code debugger (§6b).

- **Phase 7 is done (2026-10-12).** The debugger has everything in §6b except step back, which
  moved to Phase 8. The decisions are in §6b's table. Next: checking the fork's instructions
  against the wiki's reference (`ic10-test/local/instructions.md`), since G20 showed the upstream
  instruction tests can encode wrong behaviour. The steps, from 2026-10-11:
  - The DAP adapter runs in the extension, as §6b's diagram shows. A small agent in the Vitest
    process, loaded by the setup file when `IC10_DEBUG` is set, connects back over a socket
    (newline-delimited JSON). Breakpoints and stepping are decided in the agent, so a run doesn't
    wait on the adapter for every line.
  - The extension goes in `ic10-test-vscode/`, a sibling of `ic10-test/` rather than inside it, as
    its own package. It shares only the protocol's types, so each can later move to its own repo.
  - No grammar: your installed IC10 extension (florpydorp) already provides the `ic10` language and
    its highlighting. Ours declares the language and its breakpoints only. vscode-ic10's adapter
    turned out a poor base (no real pause, global breakpoints, all three steps the same, no
    `setVariable`), so no code is copied from it, only its scope layout.
  - Installed as a local `.vsix`. All of §6b's extras are in: tick commands, data breakpoints,
    inline values, debugging the TypeScript too, and launching from a scenario. Step back stays in
    Phase 8: `snapshot()` has no restore and leaves out the stack, line and defines.
  - Order: harness additions, the agent, its inspection, attaching from Vitest, the adapter, the
    extension and `.vsix` (then the "done when" check), CodeLens, the extras, docs.
  - Step 1 is done: what a debugger reads. A chip's `path` (absolute, for `file:` programs),
    `setStackAt`, `defines()` (the script's defines, aliases and labels), `sleepUntil` and
    `linesThisTick`; `world.listEvents()` (with each event's next tick; `at`, `every` and `when`
    take a `label`) and `world.listModels()`; a gate hook `onEvent`; `formatValue` exported.
  - Step 2 is done: the protocol (`ic10-test/src/debug/protocol.ts`, newline-delimited JSON,
    0-based lines, a version in its first message) and the agent's core (`DebugAgent`). The agent
    holds a test back until the adapter has set its breakpoints, and decides in the test process
    where to stop. Breakpoints are by file and line, with conditions (`Stage == 2`, `vent.On`) and
    log messages. Step Over takes a `jal` or branch-and-link call as one step, Step Into goes one
    line, and Step Out runs to after the `j ra`. Pause, halts and (if asked) automatic yields also
    stop. Each chip of each world is a thread, and inline programs' text is served. Steps and Pause
    stop only on instructions: blank, comment and label lines still run (and count toward the 128),
    but stepping one at a time through a comment block isn't useful. A run lets messages in every
    few milliseconds, so Pause works during a long one. Tests drive real worlds through an
    in-memory adapter.
  - Step 3 is done: what you see while stopped (`ic10-test/src/debug/inspect.ts`). These are the
    §6b scopes:
    - Registers, with aliases. Reference IDs are labelled, as in failure reports.
    - Stack: up to `sp` with the top marked, then any entries above it that hold something (what
      `put` wrote).
    - Devices: by pin, then `db`, then the rest of the network, each with its ID, prefab, name,
      network, properties and slots. A Logic Mirror shows its target.
    - Atmospheres.
    - World: tick, time, lines this tick out of 128, auto-yields, sleep, scheduled events and
      models.
    - Defines.

    Registers, stack entries, device properties and slot values are editable. A new value is an
    expression on the chip (`Max`, `$1488`); readings from a pipe or room aren't editable. Evaluate
    serves hovers, Watch and the Debug Console. A device or pipe expands to its rows, and a hover on
    a logic type (`Setting`) shows its catalogue description, since DAP has no tooltip for a
    variable row.

    Also in step 3, steps through nested and recursive calls. The stack is IC10's call stack, as in
    assembly: a function that calls another does `push ra` … `pop ra` and leaves `sp` where it found
    it (your point).
    - Step Over a call stops at the line after it once `sp` is back to its value at the call, or
      once the calls and `j ra`s since have evened out (for a function that leaves a result on the
      stack). A recursive call returning to that line deeper down doesn't stop it.
    - Step Out counts calls and `j ra`s, since an inner call can return with the same `sp` the step
      started at. It stops after the function's own return.
    - A function that returns some other way (`jr`, a jump to a label) can still confuse Step Out.
  - Step 4 is done: attaching from Vitest. When `IC10_DEBUG=<port>` is set, the setup file
    connects to the adapter (`attachDebugger`, `ic10-test/src/debug/attach.ts`) and makes its agent
    the default gate. Tests need no changes. If the debugger goes away, the test runs on.
    - Checked on Vitest 5: `vitest run <file>:<line>` selects the `it` starting on that line, also
      with an absolute Windows path, and `--testTimeout=0` turns the timeout off (the default
      failed a 7 s test at 5 s). No test in `tests/` sets its own timeout.
    - `ic10-test/test/debug-attach.test.ts` runs a fixture test in a child Vitest against a real
      socket. It stops at a breakpoint, steps, sets a register (which makes the test's expectation
      fail, so the edit really reaches the test), continues, and checks that the run ends with
      "terminated" and only that test run.
  - Step 5 is done: the adapter, in the new sibling package `ic10-test-vscode/` (a workspace member,
    `@vscode/debugadapter` 1.68). `src/adapter.ts` imports nothing from `vscode`.
    - It turns a launch config (`test`, `line`, `stopOnEntry`, `cwd`, `runtimeExecutable`, `args`,
      `env`) into `node vitest.mjs run <test>:<line> --testTimeout=0` with `IC10_DEBUG` set. It runs
      in the folder of the nearest `vitest.config.*`, and the output goes to the Debug Console.
    - It translates DAP to the protocol and back: 1-based lines, one frame per chip (named by its
      line's text), and halts and automatic yields as exception stops with two exception filters.
    - The agent is used only after its `hello`, and breakpoints set before then are sent first. If
      the versions differ, the run stops with a message.
    - How Vitest is started is a parameter, so the extension can start it under the Node debugger
      (step 11).
    - `ic10-test-vscode/test/adapter.test.ts` drives it with `DebugClient`, as VS Code would,
      against real Vitest runs of fixture tests that use the harness through its package names. It
      covers a breakpoint in an `.ic10` file, Step Over, variables, hover, a register edit, the run
      ending with the test's exit code, a halt as an exception with an inline program's source,
      stop on entry, and a bad launch.
  - Step 6 is done, and with it Phase 7's "done when" (checked by you in VS Code, 2026-10-11).
    - The extension (`ic10-test-vscode/src/extension.ts`) runs the adapter inside VS Code. It
      contributes the `ic10` language (no grammar), breakpoints in `.ic10` files, the `ic10-test`
      debugger with launch snippets, and **IC10 Test: Debug IC10 in the Test at the Cursor**,
      which runs the `it` or `describe` the cursor is in. F5 with no launch.json debugs the test
      file in the editor. A file counts as a test file by having an `it(`, `test(` or `describe(`
      in it, not by its name.
    - It's bundled with esbuild and packaged with `vsce` (`npm run vscode:package -w
      ic10-test-vscode` writes `dist/ic10-test-vscode.vsix`, 30 KB), with publisher `tasermonkey`,
      the repo as homepage, and `.vscode/launch.json` for running it from source.
    - Both packages are now `AGPL-3.0-or-later`, each with a LICENSE file (§8).
    - Found while you tried it:
      - VS Code gives paths a lowercase drive letter. Run from `c:\…`, Vitest loaded a second copy
        of its runner, the setup file's `afterAll` failed, and no test loaded, which looked like
        "sometimes it doesn't work". The adapter now runs Vitest with the path as the file system
        spells it, and a test passes lowercase paths.
      - Vitest takes about 3 s to start, so the Debug Console now says so at once ("starting
        Vitest for …"), with a progress indicator until the test connects.
      - Stop ends the test's worker too: a test checks it. A process-tree kill turned out not to
        be needed. Each launch is its own session (your decision).
      - The Call Stack now has a frame for each call (your point that the stack is the call
        stack). The agent keeps each chip's calls, popping a call when the chip is back at its
        return line, right after a `j ra` or with `sp` back where it was. A frame is named by its
        label and the line it returns to, e.g. `inner (returns to line 24)`. Step Over and Step
        Out now go by the same depth, and a restart clears the calls.
        `ic10-test-vscode/test/fixtures/calls.ic10` has nested and recursive calls to try it on.
  - Step 7 is done: a **▶ Debug IC10** CodeLens above each `it`, `test` and `describe` in a
    TypeScript or JavaScript file on disk, found the same way as the command's test (by content).
    It runs that one test or group, as the cursor command does; its tooltip names it. The setting
    `ic10-test.codeLens` turns the lenses off. The lenses and the cursor command show only in a
    workspace with IC10 in it (an `.ic10` file, or `@tasermonkey/ic10-test` in `node_modules`), and
    the extension starts in such a workspace, so other TypeScript projects don't see it.
  - Step 8 is done: the tick commands, on the debug toolbar and in the command palette while an
    IC10 session is stopped. Each goes by the chip focused in the Call Stack, or the one that last
    stopped.
    - **Step Tick** runs that chip to its first instruction in its next turn, past its `yield`,
      `sleep` or automatic yield, while the other chips run as usual. On a chip that hasn't run yet
      in this tick, it stops at its turn in this tick. It's refused for a chip that has halted or
      ended.
    - **Run N Ticks…** asks how many, and stops between ticks once that many of the chip's world
      have finished. The tick in progress counts as one. It also stops when every chip is asleep.
    - **Run Until Event…** offers the world's scripted events to come (`world.listEvents()`), or
      any event. It stops just after the event runs, before that tick's models and chips.
    - In the protocol (now version 2) these are the agent requests `stepTick`, `runTicks`,
      `runUntilEvent` and `events`, with stop reasons `tick` and `event`. The adapter takes them as
      DAP custom requests. The agent sends a `continued` event ahead of its response, so VS Code
      learns the test ran on before the next stop arrives. The gate's `onTick` also lets messages
      in, so Pause works while every chip sleeps.
    - Agent tests cover each command. An adapter test runs all three through `DebugClient` on a
      fixture test with a `dusk` event.
  - Step 9 is done: **data breakpoints** (right-click a value, Break on Value Change).
    - What can be watched: registers, stack entries, device properties, pipe and room readings,
      and Watch expressions. A data breakpoint's ID names the world, chip and expression (what
      `evaluate` reads: `r15`, `d0.On`, the new `stack[3]`, `coolant.Temperature`). So VS Code
      keeps it for the next run of the same test, and the agent picks it up once that chip's world
      appears. Conditions work. Defines, labels, devices and slots are refused, with a reason.
    - The gate has a new `afterLine` hook. After each line the agent compares the watched values,
      and a change stops on the chip that ran the line, naming it: `r15 (Stage) on ic: 0 → 1, by
      line 4 (add Stage Stage 1)`. Before each line, after each event and at each tick's end it
      catches changes made outside the chips, naming the event if there was one. A value edited
      while stopped isn't a change.
    - After a stop that comes after a line (a data breakpoint, an automatic yield), the chip is
      shown at its next line. Carrying on now runs that line instead of stopping on it again; a
      first Step used to look as if it did nothing.
    - Protocol version 3. Agent tests cover a register, a device a line sets, a reading an event
      changes, a condition, the stack, a change the test makes between runs, edits while stopped,
      and the refusals. An adapter test covers a data breakpoint set while stopped, and one kept
      from an earlier session (sent before the test connects). The examples gained
      `data-breakpoints`.
  - Step 10 is done: **inline values**, an `InlineValuesProvider` for the `ic10` language. While
    stopped, each line up to the one stopped at (VS Code's convention, as for JavaScript) shows the
    registers and register aliases it uses, and the device property an `l` or `s` reads or writes
    (`Vent.On`), plus the entry `put`, `get` and `poke` address (`stack[10] = 3`). On the line
    stopped at only, it shows where a `push` writes and what it overwrites, and what a `pop` or
    `peek` reads (your request; on lines above, `sp` has moved on). The agent's `evaluate` gives
    each value on the stopped chip, so aliases and device aliases work, and it now reads another
    device's memory (`d0.stack[2]`; a housing's is its chip's stack). Instruction names, labels,
    defines, numbers and comments are skipped. Finding and labelling are pure functions
    (`ic10-test-vscode/src/inline-values.ts`) with their own tests. VS Code's `debug.inlineValues`
    setting turns them off.
  - Step 11 is done: **debugging the TypeScript too.** With `"debugTypeScript": true` in a launch
    configuration, or the setting `ic10-test.debugTypeScript` (your choice; off by default, used by
    the CodeLens, the cursor command, F5 and any configuration that doesn't set it), the extension
    gives the session a launcher (`src/js-debug.ts`) that starts Vitest through VS Code's own
    JavaScript debugger (`vscode.debug.startDebugging`, `autoAttachChildProcesses` for the worker).
    Breakpoints in the test's TypeScript then stop as well as those in `.ic10` scripts.
    - The js-debug session is a child of the IC10 session (`parentSession`, compact, console merged
      with the parent's, restart managed by the parent).
    - It gets the same `IC10_DEBUG` port through its `env`. The adapter now hands launchers only
      what to add to the environment, and the default launcher merges in its own.
    - Stopping the IC10 session stops the child. The child ending (Stop, or Vitest exiting) ends
      the IC10 session. A debug session has no exit code, so none is reported then.
    - While a TypeScript breakpoint holds the worker, the agent can't answer: the IC10 session
      shows running, and an IC10 Pause takes effect once the TypeScript carries on.
    - An adapter test covers a launcher other than the default: what it's handed, and the session
      ending without an exit code. The js-debug side needs VS Code, so it's checked by hand with the
      new `typescript` example (a room modelled in TypeScript, a thermostat script) and the launch
      configuration "Debug IC10 and TypeScript in the current test file".
  - Step 12 is done: **launching from a scenario**, a world to explore with no test. Your choices:
    a scenario is a **world module** (`x.world.ts`, whose default export builds and returns the
    world, with any events and models) or **env JSON** plus a `program` `.ic10` for one of its
    chips; it runs **as fast as it can**; the session **ends** once every chip has stopped and no
    events are due; and it starts **four ways** (below).
    - `ic10-test/src/debug/run-scenario.ts` (exported as `@tasermonkey/ic10-test/run-scenario`) runs
      it under plain Node (`node --conditions=source`, no Vitest, so it starts in about half a
      second). It attaches through `IC10_DEBUG` like a test, runs ticks until `world.idle()` (now
      public), says why it stopped, and exits when the debugger goes away. `loadScenario` builds the
      world for tests.
    - The harness gained `World.fromEnv(env, { programs: { housing: "x.ic10" } })`: the chip runs the
      file instead of the env's `code`, with its `path`, so breakpoints work. `Attached` gained
      `closed`.
    - The adapter takes `scenario`, `program` and `chip` in place of `test`. Its launch spec now has
      `nodeArgs`, `program` and `args`, so the TypeScript debugging of step 11 works for world modules
      too.
    - The four ways: a launch configuration (`"scenario": "${file}"` works on a world module, an env
      file or an `.ic10`); F5 with no launch.json on any of them; on an `.ic10`, the world module
      beside it (`x.world.ts`) or else the env JSON (`x.env.json`, `x.json`) with the script as its
      program; and a **Debug IC10 Scenario** button in the editor title whenever the open file stands
      for a scenario (`src/scenarios.ts`, with its own tests).
    - Adapter tests launch a world-module scenario (a breakpoint, then running on to its end with the
      reason) and an env JSON one with a program. The new `scenario` example (a light at nightfall,
      counting nights) has the world as a module and as env JSON, and two launch configurations.
  - Step 13 is done: the docs.
    - §6b now has the decisions table. Its step-back claim is corrected: `snapshot()` has no
      restore. The "compound launch config" is replaced by what was built (a child JavaScript
      session).
    - The harness README's Debugging section now starts with how to use the debugger.
    - The extension's README covers installing it, the ways to start it, debugging the TypeScript
      too, and scenarios.
    - §8 covers the extension's licence. The `.vsix` bundles `@vscode/debugadapter` (MIT) and now
      carries its notice (`ic10-test-vscode/THIRD_PARTY_NOTICES.md`).
  - A playground, `ic10-test-vscode/examples/`, has one small test and `.ic10` script per feature:
    breakpoints, stepping, variables, exceptions, several chips, a network of chips, the tick
    commands, data breakpoints, debugging the TypeScript too, and a scenario. The top of
    each script says what to try. They run in `npm test`. Writing them found **G19** (§2), now fixed in the fork; the fix showed
    up **G20** (`bdnvl`/`bdnvs` inverted), fixed too.

Suggested first regression tests (Phase 4):

| Review item | Test |
|---|---|
| 1.1 Alaska `stage` | Run until cooling finishes, then `toHaveNoErrors()`. Today it halts at line 57 (0-based; editor line 58). |
| 1.4 Cooling Air Mgmt | Hot pipe at 5,000 kPa, then the vent is on. |
| 1.5 CoolCleanMarsAir | Input below setpoint, then `db.Mode` returns to 0. |
| 1.6 Suit MKII chatter | O₂ low and pressure normal for 20 ticks, then `toToggleAtMost(2)` on Filtration. |
| 1.9 Battery Controller 1 | Battery 0% with generation, then the gauge isn't 0. Zero generation, then no `NaN`. |
| 1.10 Trader Vert | After the first tick, the HC display is unchanged. |
| FabControl pair | Setup writes IDs into Control's stack, Control drives the right fabricator by `ld`/`sd`, and a power switch set to off turns the light red and skips that fabricator. |

---

## 8. Licensing notes
- The fork stays **AGPL-3.0**. Keep its LICENSE, and mark modified files with change notices (§5a).
- `ic10-test/` imports the fork, so if it's distributed it should be AGPL-3.0 too. It's
  `AGPL-3.0-or-later`, with its own LICENSE file.
- `ic10-test-vscode/` (the debugger extension) is `AGPL-3.0-or-later` too, with its own LICENSE. It
  copies no code from vscode-ic10 (GPL-3.0), so it owes that project nothing. Its bundle includes
  `@vscode/debugadapter` (MIT, Microsoft), whose notice ships in the `.vsix` as
  `THIRD_PARTY_NOTICES.md`; `@vscode/debugprotocol` is types only. The bundle also includes the
  harness's protocol module, which is ours and under the same licence.
- **Your IC10 scripts** are input to the emulator, not linked code, so they can carry any licence.
  The repo has no LICENSE at the moment, which means "all rights reserved" by default.
- Generated catalogue text from `english.xml` is RocketWerkz's. Keep it out of git (§6).
- Wiki text is CC BY-SA and GFDL. It may be committed in its own data directory with a CC BY-SA
  `LICENSE` and a generated `ATTRIBUTION.md` (§6). It is never mixed into AGPL code files.

---

## Appendix: spike notes (2026-10-07)
- `Builder.from(env)` → for each runner, `switchContext("real")` and `init()` → `runner.step()` loop.
  This works with the npm package's CJS build under Node 24. The ESM build fails because of
  extensionless imports.
- Env `props` can set read-only values such as `TemperatureOutput`, which tests need for sensor
  inputs.
- `housing.props.read("Setting")` reads `db` writes. `chip.registers.get(i)` reads registers.
  `chip.defines` holds aliases, defines, labels and built-in constants.
- `alias Stage r15` / `move stage 0` gives a strong `invalid_argument_register` error, but execution
  continues (G4).
- About 3,000 lines run in about 12 ms, so performance isn't a concern.
- Reference IDs: env devices take an `id`, and `put d0 …` / `get … d0 …` into another chip's stack
  works. `ld`/`sd` fail in every form (G10), and the exception escapes `step()` (G11).
  `l r3 r1 On` (a register used as a device) gives `invalid_argument_device_pin`, which is correct;
  that form needs `ld`.
- The spike scripts are in this session's scratchpad, not the repo. Phase 0 recreates them as real
  tests.
