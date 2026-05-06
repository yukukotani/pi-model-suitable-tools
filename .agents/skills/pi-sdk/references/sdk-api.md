# SDK API

## Core factory

Use `createAgentSession()` for a single embedded session.

Important options:

- `cwd`: working directory for discovery and tool path resolution.
- `agentDir`: global Pi config directory.
- `authStorage`: credentials source.
- `modelRegistry`: model lookup and auth-aware availability checks.
- `model`: explicit model.
- `thinkingLevel`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `tools`: chosen built-in tools.
- `customTools`: inline custom tools.
- `resourceLoader`: custom discovery/override layer.
- `sessionManager`: persistence strategy.
- `settingsManager`: runtime settings.

Returned value:

- `session`: the `AgentSession`.
- `extensionsResult`: loaded extension metadata/runtime.
- `modelFallbackMessage`: warning string when a saved model could not be restored and another model was selected.

## AgentSession

High-value methods:

- `prompt(text, options?)`: send user input.
- `steer(text)`: queue a steering message during streaming.
- `followUp(text)`: queue a follow-up message during streaming.
- `subscribe(listener)`: receive events; returns unsubscribe.
- `setModel(model)`: switch model.
- `setThinkingLevel(level)`: set thinking level.
- `compact(customInstructions?)`: compact context.
- `abort()`: abort current work.
- `bindExtensions(bindings)`: attach UI/command/runtime bindings when using extensions.
- `dispose()`: cleanup.

Useful properties:

- `sessionFile`
- `sessionId`
- `agent`
- `model`
- `thinkingLevel`
- `messages`
- `isStreaming`

## Prompting rules

Basic prompt:

```ts
await session.prompt("Review the repository structure.");
```

Prompt with images:

```ts
await session.prompt("Describe this image.", {
	images: [
		{
			type: "image",
			source: { type: "base64", mediaType: "image/png", data: base64Png },
		},
	],
});
```

If the agent is already streaming, do one of these:

- call `session.steer(...)`
- call `session.followUp(...)`
- or call `session.prompt(..., { streamingBehavior: "steer" | "followUp" })`

Do not call `session.prompt()` during streaming without `streamingBehavior`.

## Events

Most integrations only need `subscribe()`.

Common event types:

- `message_update`: assistant streaming updates such as `text_delta`.
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `message_start`
- `message_end`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `queue_update`
- `compaction_start`
- `compaction_end`
- `auto_retry_start`
- `auto_retry_end`

Minimal streaming handler:

```ts
session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});
```

## Auth and models

Default pattern:

```ts
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
```

Important behaviors:

- `AuthStorage.create()` uses Pi auth storage on disk.
- `authStorage.setRuntimeApiKey(provider, key)` overrides the API key in memory only.
- `ModelRegistry.create(authStorage)` includes built-in and custom models.
- `ModelRegistry.inMemory(authStorage)` uses built-in models only.
- `await modelRegistry.getAvailable()` returns models with configured auth.

See `assets/examples/auth-and-model.ts`.

## Settings

Use `SettingsManager` when the host app needs deterministic runtime behavior.

```ts
import { SettingsManager } from "@mariozechner/pi-coding-agent";

const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2 },
});
```

Important behavior:

- getters and setters update in-memory state immediately
- persistence from setters is queued asynchronously
- call `await settingsManager.flush()` when durability matters
- surface I/O issues with `settingsManager.drainErrors()` in the app layer

See `assets/examples/settings-and-memory.ts`.

## Resource loading

Use `DefaultResourceLoader` to discover or override:

- extensions
- skills
- prompt templates
- themes
- context files
- system prompt

Typical pattern:

```ts
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
	systemPromptOverride: () => "You are a careful coding assistant.",
});

await loader.reload();
```

If a custom `resourceLoader` is passed, `cwd` and `agentDir` no longer control resource discovery inside that loader. They still affect session naming and tool path resolution.

See `assets/examples/resource-loader.ts`.
