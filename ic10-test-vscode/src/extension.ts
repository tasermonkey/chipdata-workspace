/**
 * The VS Code side: registers the `ic10-test` debugger (its adapter runs inside the extension host)
 * and a command that debugs the test at the cursor.
 */
import * as vscode from "vscode";
import { type Ic10LaunchArgs, Ic10TestSession } from "./adapter.ts";
import { findTests, testAt } from "./tests.ts";

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory("ic10-test", {
			createDebugAdapterDescriptor: () =>
				new vscode.DebugAdapterInlineImplementation(new Ic10TestSession() as unknown as vscode.DebugAdapter),
		}),
		vscode.debug.registerDebugConfigurationProvider("ic10-test", { resolveDebugConfiguration }),
		vscode.commands.registerCommand("ic10-test.debugTestAtCursor", debugTestAtCursor),
	);
}

export function deactivate(): void {}

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
		return launchConfig(editor.document, undefined);
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
	const test = testAt(editor.document.getText(), editor.selection.active.line);
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	await vscode.debug.startDebugging(folder, launchConfig(editor.document, test));
}

function launchConfig(
	document: vscode.TextDocument,
	test: { name: string; line: number } | undefined,
): vscode.DebugConfiguration & Ic10LaunchArgs {
	return {
		type: "ic10-test",
		request: "launch",
		name: test ? `Debug IC10: ${test.name || `line ${test.line + 1}`}` : "Debug IC10: whole file",
		test: document.uri.fsPath,
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
		/\.[cm]?[jt]sx?$/.test(document.fileName) &&
		findTests(document.getText()).length > 0
	);
}
