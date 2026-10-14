import { describe } from "vitest";
import { describeGasMixer } from "../../support/gas-mixer.ts";

// 2/3 nitrogen and 1/3 CO2, which the O2-CO2-N mixer then makes breathable.
// Gas Input 2 is the CO2, not O2 (it was once named "O2 Tank").
describe("MBA - N-CO2 Mixer", () => {
	describeGasMixer({
		script: "ic10/ClimateControl/AirMixers/MBA - N-CO2 Mixer [43093].ic10",
		mixer: "GM N-CO2",
		input1: "PA Nitrogen",
		input2: "PA CO2",
		output: "PA N-CO2",
		ratio: 0.6666666,
		minPressure: 15000,
		minMoles: 10,
	});
});
