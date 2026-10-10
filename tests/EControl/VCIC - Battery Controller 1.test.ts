import { describe } from "vitest";
import {
	describeBatteryDisplays,
	describeCoalGenerator,
	describeGenerationDisplays,
	describeLowCoalWarning,
	describePowerDelta,
	describeTransformer,
} from "./power.ts";

// Battery Control and Power Controller Battery in one chip.
const SCRIPT = "ic10/EControl/VCIC - Battery Controller 1.ic10";

describe("VCIC - Battery Controller 1", () => {
	describeCoalGenerator(SCRIPT);
	describeLowCoalWarning(SCRIPT);
	describeBatteryDisplays(SCRIPT);
	describeGenerationDisplays(SCRIPT);
	describePowerDelta(SCRIPT);
	describeTransformer(SCRIPT);
});
