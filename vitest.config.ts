import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Resolve @tasermonkey/ic10 to its TypeScript sources (the "source" export condition)
		// so tests run against the submodule without building it first.
		conditions: ["source"],
	},
	ssr: {
		resolve: {
			conditions: ["source"],
		},
	},
	test: {
		include: ["tests/**/*.test.ts", "ic10-test/test/**/*.test.ts", "ic10-test-vscode/test/**/*.test.ts",
			// The debugger's playground: one test per feature, to try it on (ic10-test-vscode/examples/README.md).
			"ic10-test-vscode/examples/*.test.ts",
		],
		// The IC10 matchers (toHaveProps, toHaveRegister, toHaveNoErrors, …).
		setupFiles: ["./ic10-test/src/matchers/vitest-setup.ts"],
	},
});
