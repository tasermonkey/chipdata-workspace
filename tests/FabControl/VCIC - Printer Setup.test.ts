import { describe, expect, it } from "vitest";
import { parseId, sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

const SETUP = "ic10/FabControl/VCIC - Printer Setup.ic10";
const CONTROL = "ic10/FabControl/VCIC - Printer Control.ic10";

const BLOCK = 12; // stack slots per fabricator
const LAST_SLOT = 84; // the end of the last commented-out block

/** Each live block's start and contents, in the order Control reads them (slot 10 repeats the dial). */
const BLOCKS: [start: number, ids: (string | number)[]][] = [
	[1, ["$1488", "$3606", "$AE16A", "$AE19B", "$AE87A", "$AEF03", "$AE0D8", "$AEEEA", "$AEEF9", "$AEF03", 0, 0]],
	[13, ["$2736", "$360F", "$C3042", "$C3007", 797452, "$C2AB1", "$C2AF0", "$C2A6A", "$C2A6F", "$C2AB1", 0, 0]],
	[25, ["$2217", "$3607", "$C3D42", "$C5295", 802081, "$C3D17", "$C3D27", "$C3CF5", "$C3CFA", "$C3D17", 0, 0]],
];

/** Slots 0 to 84 of the memory Setup fills: the count, three blocks, and zeros where the rest are commented out. */
function expectedLayout(): number[] {
	const slots = new Array<number>(LAST_SLOT + 1).fill(0);
	slots[0] = BLOCKS.length;
	for (const [start, ids] of BLOCKS) {
		ids.forEach((id, i) => (slots[start + i] = typeof id === "number" ? id : parseId(id)));
	}
	return slots;
}

/** Setup with an idle chip on d0 in place of Control, and no fabricators built. */
function buildAlone() {
	return sim({ root: REPO_ROOT })
		.housing("memory", { code: "yield\nj 0" })
		.housing("setup", { file: SETUP, pins: { d0: "memory" } })
		.build();
}

const slots = (world: Awaited<ReturnType<typeof buildAlone>>) =>
	Array.from({ length: LAST_SLOT + 1 }, (_, i) => world.device("memory").stackAt(i));

describe("VCIC - Printer Setup", () => {
	it("writes the fabricator count and three blocks of 12, and nothing for the commented-out ones", async () => {
		const world = await buildAlone();
		await world.runTicks(1);

		expect(world.chip("setup").ended).toBe(true); // 101 lines: done in its first tick
		expect(slots(world)).toEqual(expectedLayout());
		expect(BLOCKS.map(([start]) => start)).toEqual([1, 1 + BLOCK, 1 + 2 * BLOCK]);
		expect(world.chip("setup")).toHaveNoErrors();
	});

	it("writes the same layout when run again, putting Control's saved amount and mode back to 0", async () => {
		const world = await buildAlone();
		await world.runTicks(1);
		world.chip("memory").setStackAt(35, 20); // what Control pokes: the pipe bender's amount and mode
		world.chip("memory").setStackAt(36, 1);

		world.device("setup").set("On", 0);
		await world.runTicks(1);
		world.device("setup").set("On", 1);
		await world.runTicks(1);

		expect(world.chip("setup").restarts).toHaveLength(1);
		expect(slots(world)).toEqual(expectedLayout());
	});

	it("doesn't check the devices are there, so Control halts on a fabricator that's gone", async () => {
		// One unpressed button on the network, so Control goes straight to the pipe bender's block
		// (the last, read first). With no buttons at all, `lb … Maximum` reads -Infinity and it scans them.
		const world = await sim({ root: REPO_ROOT })
			.device("button", "ModularDeviceRoundButton")
			.housing("setup", { file: SETUP, pins: { d0: "control" } })
			.housing("control", { file: CONTROL })
			.build();
		await world.runTicks(2);

		expect(world.chip("setup")).toHaveNoErrors();
		expect(world.chip("control")).toHaveHalted({ line: 40 }); // checkOff's `ld Tmp Param1 On`: its power light
	});
});
