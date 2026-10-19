# Working on these scripts

Stationeers IC10 scripts, their tests, and which chip in game runs which. The README says what's
here for people browsing; this is for changing it.

## Layout

| Path | What's in it |
| --- | --- |
| `ic10/<Category>/*.ic10` | The scripts: the source of truth, sent to the game from here. Each folder's README says what its scripts do; `ic10/Tests/` is for trying out ic10-link. |
| `tests/<Category>/<Script>.test.ts` | A script's tests, on IC10 Bench. `tests/support/` has the shared helpers (`REPO_ROOT`, `readRepoScript`). |
| `tests/scripts.test.ts` | Every script, with no test of its own needed: lint, and a 50-tick run with nothing connected. |
| `tests/stations.test.ts` | Every station map's scripts exist. |
| `stations/<station>.json` | Per save game, chip id → script, for ic10-link. A chip's id is the number in brackets in its file's name in the game's chipdata folder. |
| `ic10-lint.json` | Which lint rules are errors, and the scripts allowed over a limit (with why). A script that breaks a rule on purpose, like an in-game audit of the game's errors, gets an override turning that rule off; a key with `*` covers a folder (`"ic10/Audit/**"`). The same file decides `npm test`, `npm run lint`, and whether ic10-link sends a script. |
| `ic10-mods/` | The modded devices the scripts talk to, so the tests can use them. |
| `local/` | Not committed, on this machine only. `local/instructions.md` is the IC10 instruction reference, from the wiki. |

## The game

- A script must fit the game: 128 lines, 90 columns, 4096 bytes. Lint checks them. Say so when a
  change pushes a script over, or near, a limit.
- Comment and blank lines count toward the 128, and take a line address: `j 4` lands on the file's
  fifth line, comments included. Jump to labels.
- Tanks aren't logic devices: scripts read a tank's gas from a pipe analyzer on its network.
- Only the Diode, the console LEDs and the Beacon have `Color`.
- Reading a logic type a device doesn't have halts the chip. `npx ic10-bench props <prefab>` lists
  what a device has.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Every test, and lint on every script. |
| `npx vitest run "tests/<Category>/<Script>.test.ts"` | One script's tests. |
| `npm run lint` | Lint only. |
| `npm run typecheck` | The tests' types. |
| `npm run ic-link:status` | Which chip runs which script in the save played last, and whether each matches. |
| `npm run ic-link` | Watches: a saved script goes to its chips if it has no lint errors and its tests pass, and a chip edited in game comes back into its script. Until Ctrl+C. |
| `npm run ic-link:repl` | A prompt for ic10-link's commands (`status`, `map`, …), with `watch` in the background until `stop`. For a person at a terminal; not for scripted use. |

## Tests

- Build the scene with `sim({ root: REPO_ROOT })…housing("ic", { file: SCRIPT, pins }).build()`,
  as `tests/EControl/Room Lights.test.ts` does.
- Test what the script reacts to, not timing: `runUntil` the threshold it acts on, then check what
  it did. Rates and planet numbers are guesses; report behaviour that depends on them, rather than
  asserting it.
- Read a script's constants from it (`readRepoScript`) rather than repeating them, so changing a
  `define` doesn't break its test.
- `runUntil` predicates can run before the script's aliases exist: read raw registers (`r15`).
- A test file names its script (`const SCRIPT = "ic10/…"`): that's how `npm run ic-link` knows
  which tests to run before sending it.

## Fixing a chip

1. `npm run ic-link:status`: find the chip, and the script it runs.
2. Write a test that fails the way the chip misbehaves.
3. Fix the script, and run its tests, then `npm test`.
4. With `npm run ic-link` running, saving the script sends it to the chip once it passes.

Edits made in game come back into the script; `git diff` shows them.

## Rules

- Edit files with the editing tools, not sed or scripts.
- Keep `npm test` and `npm run typecheck` passing.
- Commit only when asked.
