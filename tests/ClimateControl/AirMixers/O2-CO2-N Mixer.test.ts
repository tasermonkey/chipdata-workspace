import { describe } from "vitest";
import { describeGasMixer } from "../../support/gas-mixer.ts";

// 3/4 of the N-CO2 mix from the N-CO2 mixer, and 1/4 oxygen.
describe("O2-CO2-N Mixer", () => {
	describeGasMixer({
		script: "ic10/ClimateControl/AirMixers/O2-CO2-N Mixer.ic10",
		mixer: "GM O2-N-CO2",
		input1: "PA N-CO2",
		input2: "PA O2",
		output: "PA Breathable Air",
		ratio: 0.75,
		minPressure: 15000,
		minMoles: 10,
	});
});
