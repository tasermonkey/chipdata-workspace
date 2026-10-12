/**
 * The VS Code side: registers the `ic10-test` debugger (its adapter runs inside the extension host),
 * a "▶ Debug IC10" CodeLens above each test, a command that debugs the test at the cursor, the
 * tick commands (Step Tick, Run N Ticks, Run Until Event) on the debug toolbar, and inline values.
 */
import * as vscode from "vscode";
import type { EventInfo } from "@tasermonkey/ic10-test/debug-protocol";
import { type Ic10CustomRequests, type Ic10LaunchArgs, Ic10TestSession } from "./adapter.ts";
import { findInlineValues, resolveInlineValues } from "./inline-values.ts";
import { describeTest, findTests, type TestBlock, testAt } from "./tests.ts";

/** The languages a test file can be in. */
const TEST_LANGUAGES = ["typescript", "javascript"];

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory("ic10-test", {
			createDebugAdapterDescriptor: () =>
				new vscode.DebugAdapterInlineImplementation(new Ic10TestSession() as unknown as vscode.DebugAdapter),
		}),
		vscode.debug.registerDebugConfigurationProvider("ic10-test", { resolveDebugConfiguration }),
		vscode.commands.registerCommand("ic10-test.debugTestAtCursor", debugTestAtCursor),
		vscode.commands.registerCommand("ic10-test.debugTest", debugTest),
		vscode.commands.registerCommand("ic10-test.stepTick", stepTick),
		vscode.commands.registerCommand("ic10-test.runTicks", runTicks),
		vscode.commands.registerCommand("ic10-test.runUntilEvent", runUntilEvent),
		vscode.languages.registerInlineValuesProvider({ language: "ic10" }, { provideInlineValues }),
		registerCodeLenses(),
	);
}

export function deactivate(): void {}

/**
 * Whether the workspace has IC10 in it: an `.ic10` file, or the harness installed. Elsewhere (any
 * other TypeScript project) the lenses and the cursor command stay hidden.
 */
async function hasIc10(): Promise<boolean> {
	if ((await vscode.workspace.findFiles("**/*.ic10", "**/node_modules/**", 1)).length > 0) return true;
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, "node_modules/@tasermonkey/ic10-test"));
			return true;
		} catch {
			// not installed in this folder
		}
	}
	return false;
}

/**
 * "▶ Debug IC10" above every `it`, `test` and `describe`, in a workspace with IC10 in it (see
 * `hasIc10`), unless `ic10-test.codeLens` is off. Also sets the `ic10-test.inWorkspace` context key.
 */
function registerCodeLenses(): vscode.Disposable {
	const changed = new vscode.EventEmitter<void>();
	let inWorkspace = false;
	const recheck = async (): Promise<void> => {
		const now = await hasIc10();
		if (now === inWorkspace) return;
		inWorkspace = now;
		await vscode.commands.executeCommand("setContext", "ic10-test.inWorkspace", now);
		changed.fire();
	};
	void recheck();
	const ic10Files = vscode.workspace.createFileSystemWatcher("**/*.ic10", false, true, true);
	const provider: vscode.CodeLensProvider = {
		onDidChangeCodeLenses: changed.event,
		provideCodeLenses(document) {
			if (!inWorkspace) return [];
			if (!vscode.workspace.getConfiguration("ic10-test", document).get("codeLens", true)) return [];
			if (document.uri.scheme !== "file") return [];
			return findTests(document.getText()).map(
				(test) =>
					new vscode.CodeLens(new vscode.Range(test.line, 0, test.line, 0), {
						title: "▶ Debug IC10",
						tooltip: `Run ${describeTest(test)} and step through its IC10 scripts`,
						command: "ic10-test.debugTest",
						arguments: [document.uri, test],
					}),
			);
		},
	};
	return vscode.Disposable.from(
		changed,
		ic10Files,
		ic10Files.onDidCreate(() => void recheck()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void recheck()),
		vscode.languages.registerCodeLensProvider(
			TEST_LANGUAGES.map((language) => ({ language, scheme: "file" })),
			provider,
		),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("ic10-test.codeLens")) changed.fire();
		}),
	);
}

/** F5 with no launch.json: debug the test file in the editor. */
function resolveDebugConfiguration(
	_folder: vscode.WorkspaceFolder | undefined,
	config: vscode.DebugConfiguration,
): vscode.DebugConfiguration | undefined {
	if (!config.type && !config.request && !config.name) {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !isTestFile(editor.document)) {
			void vscode.window.showInformationMessage("Open a test file to debug its IC10 scripts.");
			return undefined;
		}
		return launchConfig(editor.document.uri, undefined);
	}
	if (!config.test) {
		void vscode.window.showErrorMessage('An ic10-test launch configuration needs a "test" file.');
		return undefined;
	}
	return config;
}

/** Debug the `it` (or `describe`) the cursor is in. */
async function debugTestAtCursor(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !isTestFile(editor.document)) {
		void vscode.window.showInformationMessage("Put the cursor in a test (an it, test or describe) to debug its IC10 scripts.");
		return;
	}
	await debugTest(editor.document.uri, testAt(editor.document.getText(), editor.selection.active.line));
}

/** Debug one test (or group) of a file, or the whole file. What a CodeLens runs. */
async function debugTest(uri: vscode.Uri, test: TestBlock | undefined): Promise<void> {
	await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(uri), launchConfig(uri, test));
}

/**
 * Values beside the lines of the script that's stopped, up to the line it's stopped at (VS Code's
 * `debug.inlineValues` setting turns them off). The debugger evaluates each one on the stopped
 * chip, so aliases and device aliases work.
 */
async function provideInlineValues(
	document: vscode.TextDocument,
	viewPort: vscode.Range,
	context: vscode.InlineValueContext,
): Promise<vscode.InlineValue[]> {
	const session = vscode.debug.activeDebugSession;
	if (session?.type !== "ic10-test") return [];
	const items = findInlineValues(document.getText(), context.stoppedLocation.end.line).filter(
		(v) => v.line >= viewPort.start.line && v.line <= viewPort.end.line,
	);
	const evaluate = async (expression: string): Promise<string> => {
		const body = (await session.customRequest("evaluate", { expression, frameId: context.frameId, context: "watch" })) as {
			result: string;
		};
		return body.result;
	};
	const labels = await resolveInlineValues(items, evaluate);
	return labels.map((label) => new vscode.InlineValueText(new vscode.Range(label.line, label.start, label.line, label.end), label.text));
}

// --- tick commands -------------------------------------------------------------------------------

/** What Run N Ticks offers next time: the last number given. */
let lastTicks = 10;

/** Step Tick: run the focused chip to the start of its next turn. */
async function stepTick(): Promise<void> {
	const target = focused();
	if (target) await send(target, "stepTick", {});
}

/** Run N Ticks: ask how many, then run until they've finished. */
async function runTicks(): Promise<void> {
	const target = focused();
	if (!target) return;
	const answer = await vscode.window.showInputBox({
		title: "Run N Ticks",
		prompt: "How many ticks to run (the tick in progress counts as one)",
		value: String(lastTicks),
		validateInput: (text) => (/^\s*[1-9]\d*\s*$/.test(text) ? undefined : "A whole number, 1 or more"),
	});
	if (answer === undefined) return;
	lastTicks = Number(answer);
	await send(target, "runTicks", { ticks: lastTicks });
}

/** Run Until Event: pick one of the world's scripted events to come (or any), then run until it fires. */
async function runUntilEvent(): Promise<void> {
	const target = focused();
	if (!target) return;
	let events: EventInfo[];
	try {
		events = ((await target.session.customRequest("events", threadArgs(target))) as { events: EventInfo[] }).events;
	} catch (error) {
		void vscode.window.showErrorMessage(messageOf(error));
		return;
	}
	if (events.length === 0) {
		void vscode.window.showInformationMessage("This chip's world has no scripted events to come.");
		return;
	}
	type Item = vscode.QuickPickItem & { event?: string };
	const items: Item[] = [
		{ label: "Any event", description: "whichever fires next" },
		...events.map((e) => ({ label: e.label, description: describeEvent(e), event: e.label })),
	];
	const picked = await vscode.window.showQuickPick(items, { title: "Run Until Event", placeHolder: "Run until which event fires?" });
	if (!picked) return;
	await send(target, "runUntilEvent", picked.event !== undefined ? { label: picked.event } : {});
}

function describeEvent(event: EventInfo): string {
	if (event.kind === "when") return "when its condition becomes true";
	if (event.kind === "every") return `every ${event.interval} ticks, next at tick ${event.nextTick}`;
	return `at tick ${event.nextTick}`;
}

interface Target {
	session: vscode.DebugSession;
	/** The thread focused in the Call Stack; left out, the adapter goes by the one that last stopped. */
	threadId?: number;
}

/** The IC10 debug session in focus, and its chip focused in the Call Stack. */
function focused(): Target | undefined {
	const session = vscode.debug.activeDebugSession;
	if (session?.type !== "ic10-test") {
		void vscode.window.showInformationMessage("The tick commands work in an IC10 debug session, while it's stopped.");
		return undefined;
	}
	const item = vscode.debug.activeStackItem;
	return { session, ...(item && item.session.id === session.id && { threadId: item.threadId }) };
}

function threadArgs(target: Target): { threadId?: number } {
	return target.threadId !== undefined ? { threadId: target.threadId } : {};
}

async function send<K extends keyof Ic10CustomRequests>(
	target: Target,
	command: K,
	args: Omit<Ic10CustomRequests[K], "threadId">,
): Promise<void> {
	try {
		await target.session.customRequest(command, { ...threadArgs(target), ...args });
	} catch (error) {
		void vscode.window.showErrorMessage(messageOf(error));
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function launchConfig(uri: vscode.Uri, test: TestBlock | undefined): vscode.DebugConfiguration & Ic10LaunchArgs {
	return {
		type: "ic10-test",
		request: "launch",
		name: test ? `Debug IC10: ${test.name || `line ${test.line + 1}`}` : "Debug IC10: whole file",
		test: uri.fsPath,
		...(test && { line: test.line + 1 }),
	};
}

/**
 * A file on disk with tests in it. Projects choose their own Vitest file patterns (`.test.ts`,
 * `.spec.ts`, this extension's own `.debug.ts` fixtures), so it goes by content, not by name.
 */
function isTestFile(document: vscode.TextDocument): boolean {
	return (
		document.uri.scheme === "file" &&
		/\.[cm]?[jt]s$/.test(document.fileName) &&
		findTests(document.getText()).length > 0
	);
}
