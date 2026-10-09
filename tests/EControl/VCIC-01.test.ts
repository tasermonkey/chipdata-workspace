import { describe } from "vitest";
import { describeRoomLights } from "./room-lights.ts";

describe("VCIC-01", () => {
	describeRoomLights("ic10/EControl/VCIC-01.ic10", { sensors: 2 });
});
