/** Where a test (or a group of them) starts in a test file. */
export interface TestBlock {
	kind: "it" | "test" | "describe";
	/** Its name as written, if it's a plain string. */
	name: string;
	/** 0-based line of the `it(` / `test(` / `describe(`, which is what Vitest's `file:line` needs (+1). */
	line: number;
}

// `it("…"`, `test.only('…'`, `describe.each(…)(…` and so on, at the start of a line.
const START = /^\s*(it|test|describe)(?:\.\w+)*\s*\(\s*(?:(["'`])((?:\\.|(?!\2).)*)\2)?/;

/** Every `it`, `test` and `describe` that starts a line, in order. */
export function findTests(text: string): TestBlock[] {
	const out: TestBlock[] = [];
	text.split(/\r?\n/).forEach((source, line) => {
		const match = START.exec(source);
		if (match) out.push({ kind: match[1] as TestBlock["kind"], name: match[3] ?? "", line });
	});
	return out;
}

/** `it "pulls in night air"`, or `the describe on line 9` for one without a plain name. */
export function describeTest(test: TestBlock): string {
	return test.name ? `${test.kind} "${test.name}"` : `the ${test.kind} on line ${test.line + 1}`;
}

/** The test (or group) the cursor is in: the nearest `it`, `test` or `describe` starting at or above it. */
export function testAt(text: string, cursorLine: number): TestBlock | undefined {
	return findTests(text)
		.filter((t) => t.line <= cursorLine)
		.at(-1);
}
