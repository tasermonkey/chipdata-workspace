/**
 * The VS Code side: registers the `ic10-test` debugger (its adapter runs inside the extension host),
 * a "▶ Debug IC10" CodeLens above each test, a command that debugs the test at the cursor, the
 * tick commands (Step Tick, Run N Ticks, Run Until Event) on the debug toolbar, and inline values.
 * With `debugTypeScript` (or the setting of that name), Vitest runs under the JavaScript debugger
 * too (see js-debug.ts). A scenario (a world module, or env JSON) can be debugged with no test: F5
 * or the "Debug IC10 Scenario" button on it, or on an .ic10 file beside one (see scenarios.ts).
 */
import { basename } from "node:path";
import * as vscode from "vscode";
import type { EventInfo } from "@tasermonkey/ic10-test/debug-protocol";
import { type Ic10CustomRequests, type Ic10LaunchArgs, Ic10TestSession } from "./adapter.ts";
import { findInlineValues, resolveInlineValues } from "./inline-values.ts";
import { jsDebugLauncher } from "./js-debug.ts";
import { type ScenarioLaunch, scenarioFor } from "./scenarios.ts";
import { describeTest, findTests, type TestBlock, testAt } from "./tests.ts";

/** The languages a test file can be in. */
const TEST_LANGUAGES = ["typescript", "javascript"];

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory("ic10-test", {
			createDebugAdapterDescriptor: (session) => {
				const launcher = session.configuration.debugTypeScript === true ? jsDebugLauncher(session) : undefined;
				return new vscode.DebugAdapterInlineImplementation(new Ic10TestSession(launcher) as unknown as vscode.DebugAdapter);
			},
		}),
		vscode.debug.registerDebugConfigurationProvider("ic10-test", {
			resolveDebugConfiguration,
			resolveDebugConfigurationWithSubstitutedVariables,
		}),
		vscode.commands.registerCommand("ic10-test.debugTestAtCursor", debugTestAtCursor),
		vscode.commands.registerCommand("ic10-test.debugTest", debugTest),
		vscode.commands.registerCommand("ic10-test.debugScenario", debugScenario),
		trackScenarioEditor(),
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

/**
 * F5 with no launch.json: debug the test file in the editor. A configuration that doesn't say
 * whether to debug the TypeScript too goes by the `ic10-test.debugTypeScript` setting.
 */
function resolveDebugConfiguration(
	folder: vscode.WorkspaceFolder | undefined,
	config: vscode.DebugConfiguration,
): vscode.DebugConfiguration | undefined {
	if (!config.type && !config.request && !config.name) {
		const editor = vscode.window.activeTextEditor;
		const scenario = editor && scenarioOf(editor.document);
		if (editor && isTestFile(editor.document)) config = launchConfig(editor.document.uri, undefined);
		else if (scenario) config = scenarioConfig(scenario);
		else {
			void vscode.window.showInformationMessage(
				"Open a test file, or a scenario (a .world.ts module, env JSON, or an .ic10 with one beside it), to debug its IC10 scripts.",
			);
			return undefined;
		}
	}
	if (!config.test && !config.scenario) {
		void vscode.window.showErrorMessage('An ic10-test launch configuration needs a "test" file or a "scenario".');
		return undefined;
	}
	if (config.debugTypeScript === undefined) {
		config.debugTypeScript = vscode.workspace.getConfiguration("ic10-test", folder).get("debugTypeScript", false);
	}
	return config;
}

/**
 * A `scenario` that's an .ic10 file (`"scenario": "${file}"` with a script open) means the world
 * beside it; so does env JSON with its script beside it but no `program`.
 */
function resolveDebugConfigurationWithSubstitutedVariables(
	_folder: vscode.WorkspaceFolder | undefined,
	config: vscode.DebugConfiguration,
): vscode.DebugConfiguration | undefined {
	if (typeof config.scenario !== "string" || config.program !== undefined) return config;
	const found = scenarioFor(config.scenario);
	if (found) return { ...config, ...found };
	if (config.scenario.toLowerCase().endsWith(".ic10")) {
		void vscode.window.showErrorMessage(
			`No scenario beside ${basename(config.scenario)}: add ${basename(config.scenario, ".ic10")}.world.ts (or .env.json) next to it.`,
		);
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

/** Debug the scenario a file stands for (see scenarios.ts): the editor-title button. */
async function debugScenario(uri?: vscode.Uri): Promise<void> {
	const document = uri
		? await vscode.workspace.openTextDocument(uri)
		: vscode.window.activeTextEditor?.document;
	const scenario = document && scenarioOf(document);
	if (!scenario) {
		void vscode.window.showInformationMessage(
			"Open a scenario to debug: a .world.ts module, env JSON, or an .ic10 with x.world.ts or x.env.json beside it.",
		);
		return;
	}
	await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(document.uri), scenarioConfig(scenario));
}

function scenarioOf(document: vscode.TextDocument): ScenarioLaunch | undefined {
	return document.uri.scheme === "file" ? scenarioFor(document.uri.fsPath, document.getText()) : undefined;
}

/** Keeps `ic10-test.scenarioFile` true while the editor in front stands for a scenario. */
function trackScenarioEditor(): vscode.Disposable {
	const update = (): void => {
		const document = vscode.window.activeTextEditor?.document;
		void vscode.commands.executeCommand("setContext", "ic10-test.scenarioFile", !!document && !!scenarioOf(document));
	};
	update();
	return vscode.Disposable.from(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidSaveTextDocument((d) => d === vscode.window.activeTextEditor?.document && update()),
	);
}

function scenarioConfig(launch: ScenarioLaunch): vscode.DebugConfiguration & Ic10LaunchArgs {
	const name = launch.program
		? `${basename(launch.scenario)} running ${basename(launch.program)}`
		: basename(launch.scenario);
	return { type: "ic10-test", request: "launch", name: `Debug IC10 scenario: ${name}`, ...launch };
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
