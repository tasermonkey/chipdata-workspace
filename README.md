# IC 10 source for the game Stationeers

This contains varying quality of IC10 code that I have created for the game [Stationeers](https://store.steampowered.com/app/544550/Stationeers/).  They probably mostly not very re-usable on their own, without modifications, but if you some how happen on here, good luck and you are welcome to use any of them.  I keep telling myself, I
will only write simple code, and won't make too complex of control code for this game, but some of them ends up pretty complex.

I mostly play multiplayer with a couple of friends.  And none of us are this type of engineer, so the game has been decently complex for us.

## Notes
In these scripts; VC just stand for our vulcan play through.  IC is IC chips

## What's in here

- [`ic10/`](ic10/): the scripts, by what they control. Each folder's README says what its scripts do.
- [`tests/`](tests/): automated tests for those scripts.
- [`ic10-mods/`](ic10-mods/): the modded devices our scripts talk to (console parts and the like), so
  the tests can use them. `npm run import-mods` refreshes this machine's file from the game's
  Stationpedia export; see "Using modded devices" in the
  [`@tasermonkey/ic10-bench` README](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#using-modded-devices).
- [`CODE_REVIEW.md`](CODE_REVIEW.md): a review of these scripts, and what was fixed.

The tests use [IC10 Bench](https://github.com/tasermonkey/ic10-bench), which I built alongside these
scripts: [`@tasermonkey/ic10-bench`](https://www.npmjs.com/package/@tasermonkey/ic10-bench) runs IC10
scripts in an emulator without loading the game, and the
[IC10 Bench extension](https://marketplace.visualstudio.com/items?itemName=tasermonkey.ic10-bench)
lets you step through a script in VS Code while its test runs.

## Running the tests

You'll need [Node.js](https://nodejs.org/) 24 or later.

```
git clone https://github.com/tasermonkey/chipdata-workspace.git
cd chipdata-workspace
npm install
npm test
```

To test your own scripts, see the
[`@tasermonkey/ic10-bench` README](https://github.com/tasermonkey/ic10-bench/tree/main/packages/ic10-bench#getting-started).