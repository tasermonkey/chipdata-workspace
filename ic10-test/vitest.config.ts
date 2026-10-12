import { fileURLToPath } from "node:url";
import { defineIc10Config } from "./src/config.ts";

export default defineIc10Config(
	{
		resolve: {
			// Resolve @tasermonkey/ic10 to its TypeScript sources (the "source" export condition).
			conditions: ["source"],
		},
		ssr: {
			resolve: {
				conditions: ["source"],
			},
		},
		test: {
			name: "ic10-bench",
			include: ["test/**/*.test.ts"],
		},
	},
	// A small project of its own, with a few mods' devices (test/fixtures/project/ic10-mods/).
	{ project: fileURLToPath(new URL("./test/fixtures/project", import.meta.url)) },
);
