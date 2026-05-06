# Quick Start

Use Pi as a Node.js SDK through `@mariozechner/pi-coding-agent`.

## Install

```bash
npm install @mariozechner/pi-coding-agent
```

Node.js 20.6+ is required.

## Minimal shape

```ts
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Summarize the project structure.");
```

## Main objects

- `createAgentSession()`: build one `AgentSession`.
- `AgentSession`: prompt, queue follow-up input, stream events, compact, abort, switch model.
- `AuthStorage`: resolve API keys and OAuth credentials.
- `ModelRegistry`: discover built-in and custom models, check configured auth.
- `SessionManager`: choose persistence strategy.
- `SettingsManager`: load or override retry, compaction, thinking, and other settings.
- `DefaultResourceLoader`: discover or override skills, prompts, context files, themes, and extensions.
- `AgentSessionRuntime`: replace the active session when the host app needs `/new`, resume, fork, or import behavior.

## Good defaults

Use defaults when you only need one embedded session:

- `createAgentSession()`
- default auth/model resolution
- default resource discovery
- default coding tools
- default persistent session manager

Use explicit objects when embedding in another app:

- custom auth file path
- in-memory sessions for tests or server requests
- in-memory settings for deterministic behavior
- custom `cwd`
- custom or filtered tools

## First decisions

Choose the smallest option that fits:

1. Need one session only: use `createAgentSession()`.
2. Need temporary or test-only state: use `SessionManager.inMemory()` and often `SettingsManager.inMemory()`.
3. Need a specific model or auth source: create `AuthStorage` and `ModelRegistry` explicitly.
4. Need custom resources or prompt behavior: create `DefaultResourceLoader`, call `reload()`, then pass it in.
5. Need session replacement in the same running app: use `createAgentSessionRuntime()`.

## Reference map

- For API choices: read `sdk-api.md`.
- For tools/resources/extensions: read `customization.md`.
- For sessions/runtime: read `runtime-and-sessions.md`.
- For pitfalls: read `gotchas.md`.

## Example map

- `assets/examples/minimal-session.ts`: start here.
- `assets/examples/auth-and-model.ts`: choose model and auth explicitly.
- `assets/examples/settings-and-memory.ts`: disable persistence and pin behavior.
- `assets/examples/custom-cwd-tools.ts`: custom project root with correct tool factories.
- `assets/examples/custom-tool.ts`: add one small inline tool.
- `assets/examples/resource-loader.ts`: append custom app instructions and context files.
- `assets/examples/inline-extension.ts`: move into event-driven customization.
- `assets/examples/session-runtime.ts`: replace the active conversation at runtime.
