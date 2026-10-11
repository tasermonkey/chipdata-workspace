import { describe, expect, it } from "vitest";
import { dayNight, occupancySchedule, sim } from "../src/index.ts";

const OUTSIDE = { temperature: 200, pressure: 20, ratios: { CarbonDioxide: 1 } };

describe("dayNight", () => {
	it("moves the outside temperature between night and day, and the sun for daylight sensors", async () => {
		const world = await sim()
			.room("outside", OUTSIDE)
			.device("sensor", "StructureGasSensor", {}, { room: "outside" })
			.device("sun", "StructureDaylightSensor")
			.build();
		world.model(dayNight({ dayTicks: 100, room: "outside", temperature: { night: 150, day: 300 }, sensors: "sun" }));
		const temperature = world.record("sensor.Temperature");
		const up = world.record("sun.Activate");
		await world.runTicks(100);
		// Midnight, sunrise, noon and sunset, as the chips saw them in each tick.
		expect(temperature.values[1]).toBeCloseTo(150, 9);
		expect(temperature.values[26]).toBeCloseTo(225, 9);
		expect(temperature.values[51]).toBeCloseTo(300, 9);
		expect(temperature.values[76]).toBeCloseTo(225, 9);
		expect(up.values.slice(1, 26).every((v) => v === 0)).toBe(true);
		expect(up.values.slice(27, 76).every((v) => v === 1)).toBe(true);
	});

	it("puts the sun overhead at noon", async () => {
		const world = await sim().device("sun", "StructureDaylightSensor").build();
		world.model(dayNight({ startAt: 0.5, sensors: ["sun"], irradiance: 590 }));
		await world.runTicks(1);
		expect(world.device("sun")).toHaveProps({
			Activate: 1,
			Vertical: expect.closeTo(0, 9),
			SolarAngle: expect.closeTo(0, 9),
			Horizontal: expect.closeTo(180, 9),
			SolarIrradiance: expect.closeTo(590, 9),
		});
	});

	it("warms a sealed room too, and needs temperatures for a room", async () => {
		const world = await sim().room("hall", { volume: 8000, temperature: 290 }).build();
		world.model(dayNight({ startAt: 0.5, room: "hall", temperature: { night: 270, day: 310 } }));
		await world.runTicks(1);
		expect(world.room("hall").temperature).toBeCloseTo(310, 9);
		expect(() => dayNight({ room: "hall" })).toThrow("dayNight: a room needs temperature: { night, day }");
	});
});

describe("occupancySchedule", () => {
	it("counts the people in the windows covering each tick, repeating if asked", async () => {
		const world = await sim().device("occ", "StructureOccupancySensor").build();
		world.model("occ", occupancySchedule([{ from: 2, to: 5 }, { from: 4, to: 6, people: 2 }], { everyTicks: 10 }));
		const people = world.record("occ.Quantity");
		const active = world.record("occ.Activate");
		await world.runTicks(20);
		expect(people.values.slice(1, 11)).toEqual([0, 0, 1, 1, 3, 2, 0, 0, 0, 0]);
		expect(people.values.slice(11, 21)).toEqual([0, 0, 1, 1, 3, 2, 0, 0, 0, 0]);
		expect(active.values.slice(1, 11)).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
	});

	it("checks its windows", () => {
		expect(() => occupancySchedule([{ from: 5, to: 5 }])).toThrow(/must end after it starts/);
	});
});
