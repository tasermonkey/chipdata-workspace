/**
 * Every script under ic10/, checked without a test of its own: the game's size limits, that it
 * loads, its batch instructions and HASH()es against the device catalogue (mods included), style,
 * and a 50-tick run with nothing connected. Which rules are errors, and the scripts allowed over a
 * limit, are in ic10-lint.json; `npm run lint` runs the same checks (all but the idle run).
 * A script with `"host": "StructureServerRack"` in its `.ic10.json` idles in a DS-8 rack's socket.
 */
import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";
import { serverRack } from "@tasermonkey/ic10-bench-ds8";

describeScriptChecks({ extensions: [serverRack] });
