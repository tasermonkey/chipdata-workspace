import { describe, expect, it } from "vitest";
import { describeTest, findTests, testAt } from "../src/tests.ts";

const FILE = [
	'import { describe, it } from "vitest";', // 0
	"", // 1
	'describe("VCCR", () => {', // 2
	"\tit(\"pulls in night air\", async () => {", // 3
	"\t\tawait world.runTicks(3);", // 4
	"\t});", // 5
	"", // 6
	"\tit.only('expels a hot pipe', () => {});", // 7
	'\tdescribe.each([1, 2])("case %i", (n) => {', // 8
	"\t\ttest(`with ${n}`, () => {});", // 9
	"\t});", // 10
	"});", // 11
].join("\n");

describe("finding tests in a file", () => {
	it("finds every it, test and describe that starts a line, with its name", () => {
		expect(findTests(FILE)).toEqual([
			{ kind: "describe", name: "VCCR", line: 2 },
			{ kind: "it", name: "pulls in night air", line: 3 },
			{ kind: "it", name: "expels a hot pipe", line: 7 },
			{ kind: "describe", name: "", line: 8 },
			{ kind: "test", name: "with ${n}", line: 9 },
		]);
	});

	it("picks the test the cursor is in", () => {
		expect(testAt(FILE, 4)?.name).toBe("pulls in night air");
		expect(testAt(FILE, 3)?.name).toBe("pulls in night air");
		expect(testAt(FILE, 2)).toMatchObject({ kind: "describe", name: "VCCR" });
		expect(testAt(FILE, 8)).toMatchObject({ kind: "describe", line: 8 });
		expect(testAt(FILE, 0)).toBeUndefined();
	});

	it("names a test for the CodeLens tooltip, by line when it has no plain name", () => {
		const [group, first, , each] = findTests(FILE);
		expect(describeTest(group!)).toBe('describe "VCCR"');
		expect(describeTest(first!)).toBe('it "pulls in night air"');
		expect(describeTest(each!)).toBe("the describe on line 9");
	});
});
