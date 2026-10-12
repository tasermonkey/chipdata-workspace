// A scenario the adapter tests launch: a chip that counts down from 3 and ends.
import { sim } from "@tasermonkey/ic10-test";

export default () => sim({ root: import.meta.dirname }).housing("ic", { file: "countdown.ic10" }).build();
