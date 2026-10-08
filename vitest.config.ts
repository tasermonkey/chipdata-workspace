import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Resolve @stationeers-ic/ic10 to its TypeScript sources (the "source" export condition)
		// so tests run against the submodule without building it first.
		conditions: ["source"],
	},
	ssr: {
		resolve: {
			conditions: ["source"],
		},
	},
	test: {
		include: ["tests/**/*.test.ts", "ic10-test/test/**/*.test.ts"],
	},
});
