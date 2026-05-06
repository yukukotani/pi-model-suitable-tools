// @ts-nocheck
import { createAgentSession, createCodingTools, SessionManager } from "@mariozechner/pi-coding-agent";

const cwd = "/path/to/project";

const { session } = await createAgentSession({
	cwd,
	tools: createCodingTools(cwd),
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("List the TypeScript files in this project.");

session.dispose();
