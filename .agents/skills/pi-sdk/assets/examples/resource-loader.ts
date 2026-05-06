// @ts-nocheck
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

const resourceLoader = new DefaultResourceLoader({
	systemPromptOverride: () => "You are a concise assistant for an internal developer tool.",
	appendSystemPromptOverride: (base) => [
		...base,
		"## App Instructions\n- Prefer short answers\n- Mention assumptions explicitly",
	],
	agentsFilesOverride: (current) => ({
		agentsFiles: [
			...current.agentsFiles,
			{
				path: "/virtual/AGENTS.md",
				content: "# Project Rules\n\n- Keep output compact\n- Explain risky operations before running them",
			},
		],
	}),
});

await resourceLoader.reload();

const { session } = await createAgentSession({
	resourceLoader,
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Explain what style of answers you will give.");

session.dispose();
