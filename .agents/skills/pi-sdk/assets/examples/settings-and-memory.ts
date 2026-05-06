// @ts-nocheck
import {
	createAgentSession,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2, baseDelayMs: 500 },
});

const { session } = await createAgentSession({
	settingsManager,
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
	if (event.type === "auto_retry_start") {
		console.log(`\n[retry] attempt ${event.attempt}/${event.maxAttempts}`);
	}
});

await session.prompt("Say hello in three words.");

session.dispose();
