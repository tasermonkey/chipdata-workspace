// Several chips working together through each other's stacks: see controller.ic10 and worker.ic10.
import { sim } from "@tasermonkey/ic10-test";
import { describe, expect, it } from "vitest";

async function network() {
	// Chips run in the order they're built, so each tick the controller goes first.
	return sim({ root: import.meta.dirname })
		.housing("controller", { file: "controller.ic10", pins: { d0: "workerA", d1: "workerB" } })
		.housing("workerA", { file: "worker.ic10", pins: { d0: "controller" }, props: { Setting: 1 } })
		.housing("workerB", { file: "worker.ic10", pins: { d0: "controller" }, props: { Setting: 2 } })
		.build();
}

describe("network", () => {
	it("waits for both workers to answer before adding up their results", async () => {
		const world = await network();
		const controller = world.chip("controller");
		const total = world.record("controller.Setting");

		// The first round: workerA answers job 1 well before workerB answers job 10.
		await world.runUntil((w) => w.chip("controller").stackAt(3) === 1);
		expect(controller.stackAt(4)).toBe(0); // workerB is still working
		expect(controller).toHaveRegister("Total", 0); // so the controller is still waiting
		await world.runUntil((w) => w.chip("controller").reg("r3") !== 0); // Total: both answered
		expect(controller).toHaveRegister("Total", 1 * 1 + 10 * 10);

		// The second round goes the same way.
		await world.runUntil((w) => w.chip("controller").reg("r3") === 2 * 2 + 20 * 20);
		expect(controller).toHaveStack([]);
		expect([1, 2, 3, 4].map((i) => controller.stackAt(i))).toEqual([4, 400, 2, 20]);
		expect(world.chip("workerA")).toHaveStackAt(0, 3); // the third round's jobs are out
		expect(world.chip("workerB")).toHaveStackAt(0, 30);
		expect(total.values.filter((v, i) => v !== total.values[i - 1])).toEqual([0, 101, 404]); // once a round
		for (const key of ["controller", "workerA", "workerB"]) expect(world.chip(key)).toHaveNoErrors();
	});
});
