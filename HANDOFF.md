# Handoff: the DS-8 Server Rack work

Where the DS-8 work stood on 2026-10-21, for picking it up on another PC. Claude's memory and
plan files stay on the PC they were made on, so what they held is here. Delete this file once
the work is done.

## Resume prompt

Paste this into Claude Code, opened in `chipdata-workspace` on the new PC:

> I'm continuing the DS-8 Server Rack work from another PC. Read `HANDOFF.md` first: it has the
> state, the setup, what the in-game tests found, and what's next. Check the setup steps in it
> have been done (both repos checked out side by side, ic10-bench on `ds8-rack-extension` and
> built, `npm test` green here), then tell me where we are and what's next. Save the
> "Findings" and "Working preferences" sections into your memory for this project.

## Setting up the new PC

1. **Push from the old PC first** (nothing below was pushed when this was written):
   - the emulator fork: `git -C ic10-bench/vendor/ic10 push -u origin ds8-rack-extension`
   - ic10-bench: `git -C ic10-bench push -u origin ds8-rack-extension` (its `main` is also one
     commit ahead of origin)
   - chipdata-workspace: `git push` (on `main`)
2. **Check out side by side**, as on the old PC (`P:\src\tasermonkey\`):
   - `ic10-bench`, on `ds8-rack-extension`, with its submodule:
     `git clone --recurse-submodules -b ds8-rack-extension <url> ic10-bench`
   - `chipdata-workspace`, on `main`.
3. **Build ic10-bench:** `npm install`, then `npm run build`, in `ic10-bench`. chipdata links its
   packages from there (`file:../ic10-bench/packages/<pkg>` in `package.json`), and they load
   their built `dist/`, so rebuild after every change there.
4. **chipdata:** `npm install`, then `npm test` and `npm run typecheck`: both green (620 tests on
   2026-10-21).
5. **Not in git, copy by hand if wanted:** `chipdata-workspace/local/` (the wiki's IC10
   instruction list, `instructions.md`, and the saved Kit (Switch) wiki page).
6. **The game side:**
   - The mods in `ic10-mods/monkey-desk.json`, DS-8 Server Rack 5.12.2 among them.
   - IC10Sync: the per-station chipdata folders (`chipdata/<station>/`) that ic10-link expects
     come from the user's fork, tasermonkey/stationeers.ic10sync (`main`, commit ea7bbf2 "Saving
     scripts in subdirectory per save game"). Build it (`dotnet build -c Release`, with a
     hand-written `IC10Sync.csproj`, net48) and put the DLL over the Workshop copy
     (`steamapps/workshop/content/544550/3567395132/IC10Sync.dll`); the Workshop copy alone writes
     all chips into `chipdata/` itself. Its config, `BepInEx/config/IC10Sync.cfg`, needs
     `ChipDataPath` set to the Documents folder's `My Games/Stationeers/chipdata`.
   - The test save is "Real Creative For Testing"; its map is `stations/Real Creative For Testing.json`.

## Where things stand

- **The furnace setup is built and tested in the bench, not yet run in game.** It lives in
  `ic10/DS8/FurnaceControl/`: nine chips that keep running plus a run-once recipe setup chip.
  See its README (setup, ports, parts that work, diagrams) and REFERENCE.md (each chip, the
  drive and scratch cells, settings). Tests are in `tests/DS8/FurnaceControl/`.
- **The in-game audit:** `ic10/DS8/Audit/README.md`, with its `DS8 Probe … .ic10` scripts.
  Session A (the rack, A0-A9 and A8b) is done, with the results written in its Got columns.
  Sessions B (console parts), C (the Advanced Furnace) and D (the whole setup) are next.
- **The bench's rack extension** (F-08) is `packages/ic10-bench-ds8` on ic10-bench's
  `ds8-rack-extension` branch: unmerged and unpublished, while the user decides about its
  complexity. Still to do for a release: bump the fork to 1.0.2 and the tools to 1.4.0, set the
  ds8 package's peer ranges to `>=1.4.0` / `>=1.0.2`, publish, switch chipdata back to npm, and
  check the VS Code debugger on a socket chip.
- **chipdata links the checkout** (see Setting up). After the release, go back to npm versions
  and take `preserveSymlinks` out of `tsconfig.json`.

## Decisions made

- Scripts that need the mod live in `ic10/DS8/<Category>/`, tests in `tests/DS8/<Category>/`.
- Many small chips rather than a few full ones, for room to read: none of the running chips is
  over 95 lines. The setup chip (122 of 128 lines) is the exception, since it runs once.
- Recipes live on the drive in bay 1, written once by the setup chip, which can then come out.
- Devices are found by I/O port (ports 1-25), read with `get rX db <port's address>` and used
  with `ld`/`sd`. Only logic types that vanilla and ModularConsoles parts share are used, so
  either kind works; readouts can also be gauges.
- The recipe count is in drive cell **511**, not 0: the rack's Network program writes a device's
  ID to cell 0 on F1/ENT.
- Rack scripts use **`r16` and `r17`, not `sp` and `ra`** (see Findings). A test,
  `tests/DS8/rack-scripts.test.ts`, keeps it that way.
- Levers are read by `Setting`, not `Open`: a FlipCoverSwitch's `Open` is its cover (audit B1).
  Every lever part but ModularConsoles' FlipSwitch keeps its position in `Setting`.

## Findings

What the game does, from the user's runs on 2026-10-20, beyond what the bench had:

- **Ports.** In the Network program, each F3 moves a device to the next free port, so any port
  can be picked. Ports 1-6 show as d0-d5 (a device there is also d0-d5 for every chip), 7-32 as
  P7-P32. F4 empties every port. F1/ENT stores the device's ID in drive cell 0.
- **Socket chips.** The program lives on the IC10 chip item. IC10Sync names its file after the
  chip, and ic10-link sees it. A Computer with the rack's PROG selector reads and writes it. The
  IC10 Inspector sees only the rack; the rack's CPU program, Debugger tab, shows a chip's
  registers and stack, with lines counted from 0.
- **`sp` and `ra`.** A new chip given its program in a socket can fail its first run with
  IncorrectVariable at `sp` or `ra`; resetting its processor (CPU program) fixes it. A chip
  programmed in a housing and then moved, or loaded from a save, had both. The game adds the
  names whenever the holder is a circuit holder, which the rack is, and the mod's reset doesn't
  recompile, so the cause isn't pinned down.
- **Starting over.** A chip starts over at line 0 only when it's put back in its socket or its
  processor is reset. A power cycle, the drive pulled, MEM WR, I/O, and a save and load all leave
  it carrying on, registers and all. Scratch cells survive a power cycle and a load.
- **I/O off.** Port IDs still read; a batch instruction stops the chip with DeviceListNull. The
  chip carries on by itself once I/O is back.
- **Memory.** Drive cells, scratch cells (shared between chips), status registers, MEM WR off
  (writes dropped, no error) and a pulled drive (reads 0, no error) all work as the bench has them.
- **Numbers and names.** `push 0095010000` (leading zeros), `HASH("ItemIronIngot")`, `STR(...)`,
  `Color.Purple` and `rr4` read as expected. Names are case-sensitive.
- **Displays.** Mode 14 (Pa) takes pascals and adds its own prefix (kPa, MPa).
- **Levers.** A Lever's and a Switch's position is `Open`; their `Setting` is undocumented.
  ModularConsoles' Switch and FlipSwitch have no `Open`. A Button's `Setting` is 1 for a half
  second; a Dial's `Mode` is its top.

Session B (2026-10-21; its "What B found" in the audit README):

- **Levers.** `Setting` follows the position on every lever part but the FlipSwitch; `On` on the
  three modular switches. A FlipCoverSwitch's `Open` is its cover.
- **Buttons.** One tick at 1 per press, even held. **Dials.** A Setting above Mode is clamped.
- **Displays.** Kelvin mode adds a prefix too (`1.23kK`). **Gauges.** Writing Mode stops the chip
  with IncorrectLogicType.

**The bench extension now matches:** chips carry on through a power cycle, and a batch
instruction with I/O off stops with DeviceListNull. **It doesn't copy:** a chip carrying on by
itself after an error once the cause is gone (the emulator stops it for good), and the first-run
`sp`/`ra` failure.

## What's next

1. In game: audit sessions C and D (`ic10/DS8/Audit/README.md`), filling in the Got columns.
   B is done, and its lever fix is in (levers read by `Setting`).
2. Fix whatever C-D find, in the scripts and, where the bench was wrong, in the extension.
3. Known open questions C-D answer:
   - Does Reagents count 50 per Amount step for iron, as the Panel assumes?
   - Does writing Activate 0 every tick, as the Fuel Pump chip does once the furnace is hot, leave
     a burning furnace alone?
4. The F-08 release (above), when the user decides.
5. Smaller: ic10-link's `auto-map` says "no chip is named like a script" when a renamed chip is
   only waiting for its file to be picked; a clearer message would help.

## Working preferences

The user's standing rules, from Claude's memory on the old PC (CLAUDE.md has the rest):

- **Git:** commit only when asked, one commit per finished chunk; push only with approval. Every
  repo works on `main`, except the unmerged `ds8-rack-extension` branches (ic10-bench and the fork).
- **Edits:** with the editing tools, never sed or scripts. Keep `npm test` and `npm run typecheck`
  green.
- **Tests:** test what a script reacts to, not timing (`runUntil` the threshold); report behaviour
  that depends on a guessed rate rather than asserting it.
- **Limits:** say when a change pushes a script over, or near, 128 lines / 90 columns / 4096 bytes.
- **Docs:** READMEs are for users and kept short; detail goes in tables in REFERENCE.md files.
- **In-game tests:** the user runs them and fills in Got columns. In the game, comment and blank
  lines take line numbers, and the rack's debugger counts lines from 0.
- **Decompiled sources** (for checking the game or the mod): `ilspycmd -p -o <dir>
  <Stationeers>/rocketstation_Data/Managed/Assembly-CSharp.dll`, and the same for the mod's
  `ServerRack.dll` (Workshop item 3819662919), with `-r <Managed folder>`.
