import { describe } from "vitest";
import { describeRoomLights } from "./room-lights.ts";

describe("VC-IC Kitchen Bedroom EControl", () => {
	describeRoomLights("ic10/EControl/VC-IC Kitchen Bedroom EControl.ic10", { sensors: 1 });
});
