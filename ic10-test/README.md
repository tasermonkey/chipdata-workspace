# @tasermonkey/ic10-test

Test harness for Stationeers IC10 scripts. It runs them on the
[@stationeers-ic/ic10](https://github.com/tasermonkey/ic10) emulator fork, inside Vitest.

This package is self-contained so it can move to its own repository later. Nothing in `src/` may
import from outside this directory, except `@stationeers-ic/ic10` and Node built-ins.

Early stage: today it exposes `createEnv` (build an emulator world from env JSON and step its chip)
and `readScript` / `findScripts`. The planned `sim()` builder, tick scheduler and matchers are
described in the parent repo's `TEST_FRAMEWORK_PLAN.md`.

```ts
import { createEnv, readScript } from "@tasermonkey/ic10-test";
```

Runs as TypeScript source on Node 24+ (no build step yet).
