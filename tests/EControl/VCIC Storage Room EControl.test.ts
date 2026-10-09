import { describe } from "vitest";
import { describeRoomLights } from "./room-lights.ts";

describe("VCIC Storage Room(1) EControl", () => {
	describeRoomLights("ic10/EControl/VCIC Storage Room(1) EControl.ic10", { sensors: 2 });
});
