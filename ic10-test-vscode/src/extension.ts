/**
 * The VS Code side: registers the `ic10-test` debugger (its adapter runs inside the extension host),
 * a "▶ Debug IC10" CodeLens above each test, and a command that debugs the test at the cursor.
 */
import * as vscode from "vscode";
import { type Ic10LaunchArgs, Ic10TestSession } from "./adapter.ts";
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
