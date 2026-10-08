import type { EnvSchema } from "@stationeers-ic/ic10";
import { describe, expect, it } from "vitest";
import { createEnv } from "../src/index.ts";

function oneChip(code: string) {
	const env = {
		version: 1,
		chips: [{ id: 1, code }],
		networks: [{ id: "data", type: "data" }],
		devices: [
			{
				id: 100,
				PrefabName: "StructureCircuitHousingCompact",
				chip: 1,
				ports: [{ port: "default", network: "data" }],
			},
		],
	} as EnvSchema;
	return createEnv(env, 100);
}

describe("createEnv", () => {
	it("runs a chip against its housing", async () => {
		const env = oneChip("s db Setting 42");
		await env.run(10);
		expect(env.device(100).props!.read("Setting")).toBe(42);
	});

	it("stops counting when the program ends", async () => {
		const env = oneChip("move r0 1\nmove r1 2");
		expect(await env.run(100)).toBe(2);
	});

	it("reports errors in English and halts the chip", async () => {
		const env = oneChip("ld r0 d0 On\nmove r0 1");
		expect(await env.run(10)).toBe(0);
		const error = env.runner.context.criticalError;
		expect(error && error.message).toBe("You can't use pin in this instruction");
		expect(env.runner.isStopped()).toBe(true);
	});

	it("rejects an unknown device id", () => {
		expect(() => oneChip("").device(999)).toThrow("no device with id 999");
	});
});
