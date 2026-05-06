---
name: pi-sdk
description: Embed Pi in a Node.js app via @mariozechner/pi-coding-agent. Use when building your own app, service, UI, bot, or workflow that should talk to Pi from code, stream Pi responses, customize tools or prompts, manage auth/models/settings, or keep and switch conversations. Do not use for CLI-only usage.
---

# Pi SDK

Use the SDK exports from `@mariozechner/pi-coding-agent`, not CLI flows.

Follow this workflow:

1. Read `references/quickstart.md` first.
2. Pick the smallest integration shape that solves the task.
3. Read only the extra references that match the task.
4. Start from an example under `assets/examples/` and adapt it.

Read these references when needed:

- `references/quickstart.md`: minimal setup, main objects, first prompt.
- `references/sdk-api.md`: `createAgentSession()`, event flow, auth, models, settings.
- `references/customization.md`: tools, custom tools, extensions, skills, prompts, context files.
- `references/runtime-and-sessions.md`: `SessionManager`, `AgentSessionRuntime`, session replacement.
- `references/gotchas.md`: high-risk mistakes and behavior details.

Rules:

- Prefer `createAgentSession()` unless the app must replace the active session at runtime.
- Prefer the smallest customization point that works:
  - `tools` for built-in tool selection.
  - `customTools` for a few inline tools.
  - `DefaultResourceLoader` overrides for skills/prompts/context/system prompt.
  - extensions for event-driven behavior, slash commands, or reusable tools.
- When `cwd !== process.cwd()` and explicit tools are passed, use tool factories such as `createReadTool(cwd)` or `createCodingTools(cwd)`.
- When runtime session replacement is used, re-subscribe to the new `runtime.session` and call `bindExtensions(...)` again if extensions are involved.
- When implementing a file-mutating custom tool, use `withFileMutationQueue()` around the full read-modify-write section.
- Keep examples external-repo-safe. Do not assume this monorepo layout.

Examples:

- `assets/examples/minimal-session.ts`: smallest usable embed.
- `assets/examples/auth-and-model.ts`: explicit auth storage, model registry, model selection.
- `assets/examples/settings-and-memory.ts`: in-memory sessions and deterministic settings.
- `assets/examples/custom-cwd-tools.ts`: correct tool factories for custom cwd.
- `assets/examples/custom-tool.ts`: inline custom tool with `customTools`.
- `assets/examples/resource-loader.ts`: override context files and system prompt.
- `assets/examples/inline-extension.ts`: event hooks plus a custom tool.
- `assets/examples/session-runtime.ts`: runtime-backed session replacement.
