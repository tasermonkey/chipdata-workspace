// The tests the adapter tests debug (`*.debug.ts`), set up the way a project using the harness
// would be. The normal test runs don't include them. A project imports defineIc10Config from
// "@tasermonkey/ic10-bench/config"; here it comes from the checkout's source.
import { defineIc10Config } from "../../../ic10-test/src/config.ts";

export default defineIc10Config({
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
	test: {
		include: ["*.debug.ts"],
	},
});
