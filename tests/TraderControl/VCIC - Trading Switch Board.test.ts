import { describe, expect, it } from "vitest";
import { sim, type World } from "@tasermonkey/ic10-test";
import { REPO_ROOT } from "../support/paths.ts";

/** The dock switches the script lists by reference ID, in dock order (1 = Orange … 5 = Black). */
const DOCKS = [
	["orange", "$A2509"],
	["khaki", "$A250D"],
	["green", "$A2512"],
	["blue", "$A251D"],
	["black", "$A2524"],
] as const;
type Dock = (typeof DOCKS)[number][0];

const DIRECTION_SWITCHES = [
	["gasIn", "$A287A"],
	["gasOut", "$A288C"],
	["liqIn", "$A2885"],
	["liqOut", "$A2891"],
] as const;

// Stack addresses the sister chips read.
const ACTIVE_DOCK = 0;
const GAS_MODE = 1;
const LIQUID_MODE = 2;
const OFF = 0;
const INPUT = 1;
const OUTPUT = 2;

/** Console switches (the board reads their On), found by reference ID. */
function build() {
	let builder = sim({ root: REPO_ROOT });
	for (const [key, id] of [...DOCKS, ...DIRECTION_SWITCHES]) {
		builder = builder.device(key, "ModularDeviceFlipCoverSwitch", { On: 0 }, { id });
	}
	return builder.housing("board", { file: "ic10/TraderControl/VCIC - Trading Switch Board.ic10" }).build();
}

async function switchOn(world: World, key: string) {
	world.device(key).set("On", 1);
	await world.runTicks(1);
}

describe("VCIC - Trading Switch Board", () => {
	describe("dock switches", () => {
		it("record which dock is selected, for the sister chips", async () => {
			const world = await build();
			await world.runTicks(1);
			expect(world.chip("board")).toHaveStackAt(ACTIVE_DOCK, 0);

			await switchOn(world, "green");
			expect(world.chip("board")).toHaveStackAt(ACTIVE_DOCK, 3);
			expect(world.chip("board")).toHaveNoErrors();
		});

		it("act as radio buttons: switching a dock on switches the others off", async () => {
			const world = await build();
			await world.runTicks(1);
			await switchOn(world, "orange");
			await switchOn(world, "black");

			expect(world.chip("board")).toHaveStackAt(ACTIVE_DOCK, 5);
			for (const [dock] of DOCKS) expect(world.device(dock)).toHaveProps({ On: dock === "black" ? 1 : 0 });

			await switchOn(world, "khaki");
			expect(world.chip("board")).toHaveStackAt(ACTIVE_DOCK, 2);
			for (const [dock] of DOCKS) expect(world.device(dock)).toHaveProps({ On: dock === "khaki" ? 1 : 0 });
		});

		it("keep the selected dock while nothing changes", async () => {
			const world = await build();
			await world.runTicks(1);
			await switchOn(world, "blue" satisfies Dock);
			await world.runTicks(5);
			expect(world.chip("board")).toHaveStackAt(ACTIVE_DOCK, 4);
			expect(world.device("blue")).toHaveProps({ On: 1 });
		});
	});

	for (const [kind, address, inSwitch, outSwitch] of [
		["gas", GAS_MODE, "gasIn", "gasOut"],
		["liquid", LIQUID_MODE, "liqIn", "liqOut"],
	] as const) {
		describe(`${kind} direction`, () => {
			it("is off, input or output from its two switches", async () => {
				const world = await build();
				await world.runTicks(1);
				expect(world.chip("board")).toHaveStackAt(address, OFF);

				await switchOn(world, inSwitch);
				expect(world.chip("board")).toHaveStackAt(address, INPUT);

				world.device(inSwitch).set("On", 0);
				await switchOn(world, outSwitch);
				expect(world.chip("board")).toHaveStackAt(address, OUTPUT);
			});

			it("flips to the other switch when both are on", async () => {
				const world = await build();
				await world.runTicks(1);
				await switchOn(world, inSwitch);

				await switchOn(world, outSwitch); // both on: output wins, input goes off
				expect(world.chip("board")).toHaveStackAt(address, OUTPUT);
				expect(world.device(inSwitch)).toHaveProps({ On: 0 });
				expect(world.device(outSwitch)).toHaveProps({ On: 1 });

				await switchOn(world, inSwitch); // and back
				expect(world.chip("board")).toHaveStackAt(address, INPUT);
				expect(world.device(inSwitch)).toHaveProps({ On: 1 });
				expect(world.device(outSwitch)).toHaveProps({ On: 0 });
				expect(world.chip("board")).toHaveNoErrors();
			});
		});
	}
});
