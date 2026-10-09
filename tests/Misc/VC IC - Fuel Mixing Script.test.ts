import { describe } from "vitest";
import { describeGasMixer } from "../support/gas-mixer.ts";

describe("VC IC - Fuel Mixing Script", () => {
	describeGasMixer({
		script: "ic10/Misc/VC IC - Fuel Mixing Script.ic10",
		mixer: "Fuel Mixer",
		input1: "Volatiles PA",
		input2: "Oxygen PA",
		output: "Fuel Output PA",
		ratio: 0.3333333,
		minPressure: 100,
	});
});
