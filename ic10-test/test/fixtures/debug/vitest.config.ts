// Runs the debugger fixtures (`*.debug.ts`), which the attach test starts in a child Vitest with
// IC10_DEBUG set. The normal test runs don't include them.
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
	test: {
		include: ["*.debug.ts"],
		setupFiles: ["../../../src/matchers/vitest-setup.ts"],
	},
});
