# ic10emu descriptions

`descriptions.json` holds the LogicType and LogicSlotType descriptions from
[Ryex/ic10emu](https://github.com/Ryex/ic10emu) (`stationeers_data/src/enums/script.rs`, at the
commit named in its `source` field). ic10emu is licensed MIT OR Apache-2.0; both licences are here.

`catalog:build` uses these only when the game isn't installed, or for logic types the game's
`english.xml` doesn't describe. They are the game's own text as ic10emu extracted it, from an older
game version.

Refresh with `node ic10-test/tools/import-ic10emu.ts [commit]`.
