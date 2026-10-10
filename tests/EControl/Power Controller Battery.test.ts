import { describe } from "vitest";
import { describeBatteryDisplays, describeCoalGenerator, describeLowCoalWarning } from "./power.ts";

const SCRIPT = "ic10/EControl/Power Controller Battery.ic10";

describe("Power Controller Battery", () => {
	describeCoalGenerator(SCRIPT);
	describeLowCoalWarning(SCRIPT);
	describeBatteryDisplays(SCRIPT);
});
