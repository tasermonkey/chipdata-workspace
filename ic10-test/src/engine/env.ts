/**
 * Minimal engine adapter: build an emulator environment straight from the fork's env JSON and step
 * its chip. Phase 2's `sim()` builder sits on top of this; keep emulator internals in engine/.
 */
import { Builder, type Device, type EnvSchema, type Ic10Runner } from "@stationeers-ic/ic10";

export interface Env {
	builder: Builder;
	runner: Ic10Runner;
	device(id: number): Device;
	/** Execute up to `lines` lines; returns how many ran before the chip stopped. */
	run(lines: number): Promise<number>;
}

/** Build an env with every chip in the real context, ready to step. `housingId` picks the runner. */
export function createEnv(env: EnvSchema, housingId: number): Env {
	const builder = Builder.from(JSON.stringify(env));
	for (const r of builder.Runners.values()) {
		r.switchContext("real");
		r.init();
	}
	const runner = builder.Runners.get(housingId) ?? [...builder.Runners.values()][0];
	if (!runner) throw new Error("env has no chip runner");
	return {
		builder,
		runner,
		device(id) {
			const d = builder.Devices.get(id);
			if (!d) throw new Error(`no device with id ${id}`);
			return d;
		},
		async run(lines) {
			let ran = 0;
			while (ran < lines && (await runner.step())) ran++;
			return ran;
		},
	};
}
