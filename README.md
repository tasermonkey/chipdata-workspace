# IC 10 source for the game Stationeers

This contains varying quality of IC10 code that I have created for the game [Stationeers](https://store.steampowered.com/app/544550/Stationeers/).  They probably mostly not very re-usable on their own, without modifications, but if you some how happen on here, good luck and you are welcome to use any of them.  I keep telling myself, I
will only write simple code, and won't make too complex of control code for this game, but some of them ends up pretty complex.

I mostly play multiplayer with a couple of friends.  And none of us are this type of engineer, so the game has been decently complex for us.

## Notes
In these scripts; VC just stand for our vulcan play through.  IC is IC chips

## What's in here

- [`ic10/`](ic10/): the scripts, by what they control. Each folder's README says what its scripts do.
- [`tests/`](tests/): automated tests for those scripts.
- [`ic10-test/`](ic10-test/): the tool that runs those tests. Use it to test your own IC10 scripts
  without loading the game.
- [`ic10-test-vscode/`](ic10-test-vscode/): a VS Code debugger to step through a script line by line
  while its test runs.

## Testing your own scripts

You'll need [Node.js](https://nodejs.org/) 24 or later.

```
git clone --recurse-submodules https://github.com/tasermonkey/chipdata-workspace.git
cd chipdata-workspace
npm install
npm test
```

Then add your script and a test for it; the [ic10-test README](ic10-test/README.md) walks through it.