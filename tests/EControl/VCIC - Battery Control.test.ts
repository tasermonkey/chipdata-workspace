import { describe } from "vitest";
import { describeGenerationDisplays, describePowerDelta, describeTransformer } from "./power.ts";

const SCRIPT = "ic10/EControl/VCIC - Battery Control.ic10";

describe("VCIC - Battery Control", () => {
	describeGenerationDisplays(SCRIPT);
	describePowerDelta(SCRIPT);
	describeTransformer(SCRIPT);
});
