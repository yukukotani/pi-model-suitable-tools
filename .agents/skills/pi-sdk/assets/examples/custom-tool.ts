// @ts-nocheck
import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	defineTool,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

const statusTool = defineTool({
	name: "status",
	label: "Status",
	description: "Return process uptime and current working directory",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [
			{
				type: "text",
				text: `Uptime: ${process.uptime().toFixed(1)}s\nCWD: ${process.cwd()}`,
			},
		],
		details: {},
	}),
});

const { session } = await createAgentSession({
	customTools: [statusTool],
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Call the status tool, then summarize the result.");

session.dispose();
