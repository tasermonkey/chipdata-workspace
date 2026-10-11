import { connect, type Socket } from "node:net";
import { DebugAgent, type Transport } from "./agent.ts";
import { setDefaultDebugGate } from "./gate.ts";
import type { AdapterMessage, AgentMessage } from "./protocol.ts";

/** A debug agent connected to the adapter, and how to let go of it. */
export interface Attached {
	agent: DebugAgent;
	/** Say the test file is done and close the connection. */
	close(): Promise<void>;
}

/**
 * Connect to the VS Code adapter at `address` (`port` or `host:port`, from `IC10_DEBUG`) and make
 * its agent the default debug gate, so every world built from here on can be stopped. Tests don't
 * need to know: the Vitest setup file calls this when `IC10_DEBUG` is set.
 */
export async function attachDebugger(address: string): Promise<Attached> {
	const { host, port } = parseAddress(address);
	const socket = await new Promise<Socket>((resolve, reject) => {
		const s = connect({ host, port }, () => resolve(s));
		s.once("error", (error) => reject(new Error(`IC10_DEBUG=${address}: can't reach the debugger: ${error.message}`)));
	});
	socket.setNoDelay(true);
	const agent = new DebugAgent(socketTransport(socket));
	setDefaultDebugGate(agent.gate);
	// If the debugger goes away, let the test run on as if it had never been there.
	socket.on("close", () => {
		setDefaultDebugGate(undefined);
		agent.detach();
	});
	socket.on("error", () => {});
	return {
		agent,
		close: () =>
			new Promise((resolve) => {
				setDefaultDebugGate(undefined);
				if (socket.destroyed) return resolve();
				agent.terminate();
				socket.end(resolve);
			}),
	};
}

/** Messages as JSON, one per line, over a socket. */
export function socketTransport(socket: Socket): Transport {
	return {
		send: (message: AgentMessage) => {
			if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
		},
		onMessage: (handler) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newline: number;
				while ((newline = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (line) handler(JSON.parse(line) as AdapterMessage);
				}
			});
		},
	};
}

function parseAddress(address: string): { host: string; port: number } {
	const match = /^(?:(.+):)?(\d+)$/.exec(address.trim());
	if (!match) throw new Error(`IC10_DEBUG=${address}: expected a port or host:port`);
	return { host: match[1] ?? "127.0.0.1", port: Number(match[2]) };
}
