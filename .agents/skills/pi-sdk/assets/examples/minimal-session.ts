// @ts-nocheck
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

const unsubscribe = session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("What files are in the current directory?");

unsubscribe();
session.dispose();
