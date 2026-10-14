/**
 * Every script under ic10/, checked without a test of its own: the game's size limits, that it
 * loads, its batch instructions and HASH()es against the device catalogue (mods included), style,
 * and a 50-tick run with nothing connected. Which rules are errors, and the scripts allowed over a
 * limit, are in ic10-lint.json; `npm run lint` runs the same checks (all but the idle run).
 */
import { describeScriptChecks } from "@tasermonkey/ic10-bench/checks";

describeScriptChecks();
