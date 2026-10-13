import { defineIc10Config } from "@tasermonkey/ic10-bench/config";

// The scripts' tests, with this workspace's mods (ic10-mods/).
export default defineIc10Config({ test: { include: ["tests/**/*.test.ts"] } });
