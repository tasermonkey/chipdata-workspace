/** Helmet tests shared by the MKI and MKII suit controllers, which have the same helmetCheck. */
import { describe, expect, it } from "vitest";
import { sim } from "@tasermonkey/ic10-bench";
import { REPO_ROOT } from "../support/paths.ts";

interface Outside {
	pressure: number;
	temperature: number;
}

const SAFE: Outside = { pressure: 100, temperature: 293 };

/** The chip sits in the suit (db), with the helmet on d0. */
function build(script: string, helmetOpen: 0 | 1, outside: Outside, suit: { On?: number; AirRelease?: number; Filtration?: number } = {}) {
	return sim({ root: REPO_ROOT })
		.device("helmet", "ItemHardsuitHelmet", { Open: helmetOpen, Pressure: 100, RatioOxygen: 0.5, Temperature: 293 })
		.housing("suit", {
			file: script,
			prefab: "ItemHardSuit",
			pins: { d0: "helmet" },
			props: {
				PressureExternal: outside.pressure,
				TemperatureExternal: outside.temperature,
				PressureSetting: 100,
				TemperatureSetting: 293,
				...suit,
			},
		})
		.build();
}

/** `managesSuit`: whether the script runs the suit's climate and air (MKII), or only the helmet (MKI). */
export function describeHelmet(script: string, { managesSuit }: { managesSuit: boolean }): void {
	describe("helmet", () => {
		const running = { On: 1, AirRelease: 1, Filtration: 1 };
		if (managesSuit) {
			it("turns the suit's climate, air release and filtration off while the helmet is open", async () => {
				const world = await build(script, 1, SAFE, running);
				await world.runTicks(2);
				expect(world.db("suit")).toHaveProps({ On: 0, AirRelease: 0, Filtration: 0 });
				expect(world.chip("suit")).toHaveNoErrors();
			});
		} else {
			it("leaves the suit's climate, air release and filtration alone, helmet open or closed", async () => {
				for (const open of [0, 1] as const) {
					const world = await build(script, open, { ...SAFE, pressure: 0 }, running);
					await world.runSeconds(3);
					expect(world.db("suit"), `helmet open ${open}`).toHaveProps(running);
					expect(world.chip("suit")).toHaveNoErrors();
				}
			});
		}

		it("opens after 5 s in a safe atmosphere", async () => {
			const world = await build(script, 0, SAFE);
			await world.runSeconds(3);
			expect(world.device("helmet")).toHaveProps({ Open: 0 });
			await world.runSeconds(4);
			expect(world.device("helmet")).toHaveProps({ Open: 1 });
			expect(world.chip("suit")).toHaveNoErrors();
		});

		it("stays closed in a vacuum", async () => {
			const world = await build(script, 0, { ...SAFE, pressure: 0 });
			await world.runSeconds(10);
			expect(world.device("helmet")).toHaveProps({ Open: 0 });
		});

		it("closes when the pressure drops", async () => {
			const world = await build(script, 1, SAFE);
			await world.runTicks(2);
			expect(world.device("helmet")).toHaveProps({ Open: 1 });

			world.db("suit").set("PressureExternal", 10);
			await world.runTicks(2);
			expect(world.device("helmet")).toHaveProps({ Open: 0 });
		});

		// It once opened whenever the pressure was at least 40 kPa.
		const hostile: [string, Outside][] = [
			["over-pressure", { ...SAFE, pressure: 200 }],
			["hot", { ...SAFE, temperature: 350 }],
			["cold", { ...SAFE, temperature: 250 }],
		];
		for (const [name, outside] of hostile) {
			it(`stays closed when the outside is ${name}`, async () => {
				const world = await build(script, 0, outside);
				await world.runSeconds(10);
				expect(world.device("helmet")).toHaveProps({ Open: 0 });
				expect(world.chip("suit")).toHaveNoErrors();
			});

			it(`closes when the outside turns ${name}`, async () => {
				const world = await build(script, 1, SAFE);
				await world.runTicks(2);
				world.db("suit").set("PressureExternal", outside.pressure);
				world.db("suit").set("TemperatureExternal", outside.temperature);
				await world.runTicks(2);
				expect(world.device("helmet")).toHaveProps({ Open: 0 });
			});
		}

		it("stays closed if the atmosphere turns hostile during the 5 s wait", async () => {
			const world = await build(script, 0, SAFE);
			await world.runSeconds(2);
			world.db("suit").set("TemperatureExternal", 350);
			await world.runSeconds(8);
			expect(world.device("helmet")).toHaveProps({ Open: 0 });
		});
	});
}
