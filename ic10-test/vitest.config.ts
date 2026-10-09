import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Resolve @stationeers-ic/ic10 to its TypeScript sources (the "source" export condition).
		conditions: ["source"],
	},
	ssr: {
		resolve: {
			conditions: ["source"],
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		setupFiles: ["./src/matchers/vitest-setup.ts"],
	},
});
