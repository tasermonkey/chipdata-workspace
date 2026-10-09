import { describe } from "vitest";
import { describeRoomLights } from "./room-lights.ts";

describe("VC-IC Main Hall EControl", () => {
	describeRoomLights("ic10/EControl/VC-IC Main Hall EControl.ic10", { sensors: 1 });
});
