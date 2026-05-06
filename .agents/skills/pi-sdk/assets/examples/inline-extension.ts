// @ts-nocheck
import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

function loggingExtension(pi: ExtensionAPI) {
	pi.on("agent_start", async () => {
		console.log("[ext] agent_start");
	});

	pi.registerTool({
		name: "status",
		label: "Status",
		description: "Return process uptime",
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text", text: `Uptime: ${process.uptime()}s` }],
			details: {},
		}),
	});
}

const resourceLoader = new DefaultResourceLoader({
	extensionFactories: [loggingExtension],
});

await resourceLoader.reload();

const { session } = await createAgentSession({
	resourceLoader,
	sessionManager: SessionManager.inMemory(),
});

await session.bindExtensions({});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Call the status tool and summarize the result.");

session.dispose();
