// @ts-nocheck
import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const availableModels = await modelRegistry.getAvailable();
const preferredModel =
	modelRegistry.find("anthropic", "claude-sonnet-4-20250514") ??
	modelRegistry.find("openai", "gpt-5") ??
	availableModels[0];

if (!preferredModel) {
	throw new Error("No model is configured. Set an API key or login before running this example.");
}

const { session } = await createAgentSession({
	authStorage,
	modelRegistry,
	model: preferredModel,
	thinkingLevel: "medium",
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Introduce yourself in one sentence.");

session.dispose();
