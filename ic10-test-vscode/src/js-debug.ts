/**
 * Debugging the TypeScript too: a launcher that starts Vitest under VS Code's own JavaScript
 * debugger (js-debug), as a child of the IC10 session, so breakpoints in the test (and anything it
 * imports) stop as well as those in the .ic10 scripts. The IC10 session still waits for the agent:
 * the port is in the environment js-debug gives Vitest, and Vitest's worker inherits it.
 *
 * Stopping either session ends the other: the IC10 session's Stop kills the child through `kill`,
 * and the child ending resolves `exited`, which ends the IC10 session.
 */
import { basename } from "node:path";
import * as vscode from "vscode";
import type { Launcher } from "./adapter.ts";

export function jsDebugLauncher(parent: vscode.DebugSession): Launcher {
	return (spec, output) => {
		let child: vscode.DebugSession | undefined;
		let killed = false;
		let done!: (code: number | null) => void;
		const exited = new Promise<number | null>((resolve) => (done = resolve));

		const listeners = [
			vscode.debug.onDidStartDebugSession((session) => {
				if (child || session.parentSession?.id !== parent.id) return;
				child = session;
				if (killed) void vscode.debug.stopDebugging(child);
			}),
			vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.id === child?.id) finish(null);
			}),
		];
		const finish = (code: number | null): void => {
			for (const listener of listeners) listener.dispose();
			done(code);
		};

		const config: vscode.DebugConfiguration = {
			type: "node",
			request: "launch",
			name: `Vitest: ${basename(spec.args[1] ?? "tests")}`,
			runtimeExecutable: spec.command,
			program: spec.args[0],
			args: spec.args.slice(1),
			cwd: spec.cwd,
			env: spec.env,
			// The test runs in Vitest's worker, a child process.
			autoAttachChildProcesses: true,
			// Vitest's reporter writes to stdout, not through console.log.
			outputCapture: "std",
			skipFiles: ["<node_internals>/**"],
			smartStep: true,
		};
		const options: vscode.DebugSessionOptions = {
			parentSession: parent,
			lifecycleManagedByParent: true,
			consoleMode: vscode.DebugConsoleMode.MergeWithParent,
			compact: true,
		};
		vscode.debug.startDebugging(parent.workspaceFolder, config, options).then(
			(started) => {
				if (started) return;
				output("stderr", "ic10-test: VS Code's JavaScript debugger didn't start Vitest\n");
				finish(1);
			},
			(error: unknown) => {
				output("stderr", `ic10-test: can't start Vitest under the JavaScript debugger: ${String(error)}\n`);
				finish(1);
			},
		);

		return {
			exited,
			kill: () => {
				killed = true;
				if (child) void vscode.debug.stopDebugging(child);
			},
		};
	};
}
