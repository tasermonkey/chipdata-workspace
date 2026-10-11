// The tests the adapter tests debug (`*.debug.ts`), set up the way a project using the harness
// would be. The normal test runs don't include them.
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
	test: {
		include: ["*.debug.ts"],
		setupFiles: ["@tasermonkey/ic10-test/vitest"],
	},
});
