import { defineConfig } from "vitest/config";
// From source here; a project that installs the package imports "@tasermonkey/ic10-bench/config".
import { defineIc10Config } from "./ic10-test/src/config.ts";

// Resolve @tasermonkey/ic10 and @tasermonkey/ic10-bench to their TypeScript sources (the "source"
// export condition), so tests run against the checkouts without building them first.
const fromSource = {
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
};

export default defineConfig({
	test: {
		projects: [
			// The harness's own tests, with their fixture project (ic10-test/vitest.config.ts).
			"ic10-test",
			// The scripts' tests, with this workspace's mods (ic10-mods/).
			defineIc10Config({ ...fromSource, test: { name: "scripts", include: ["tests/**/*.test.ts"] } }),
			defineIc10Config({
				...fromSource,
				test: {
					name: "vscode",
					include: [
						"ic10-test-vscode/test/**/*.test.ts",
						// The debugger's playground: one test per feature, to try it on (ic10-test-vscode/examples/README.md).
						"ic10-test-vscode/examples/*.test.ts",
					],
				},
			}),
		],
	},
});
