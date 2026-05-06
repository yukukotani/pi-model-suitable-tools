# Customization

## Choose the right layer

Use the narrowest customization point that solves the task:

1. Built-in tool selection: pass `tools`.
2. A few inline tools: pass `customTools`.
3. Resource shaping: use `DefaultResourceLoader` overrides.
4. Event-driven behavior or reusable commands/tools: use extensions.

## Built-in tools

Default built-in set:

- `read`
- `bash`
- `edit`
- `write`

Read-only set:

- `read`
- `grep`
- `find`
- `ls`

Example:

```ts
import { createAgentSession, readOnlyTools } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
	tools: readOnlyTools,
});
```

See `assets/examples/custom-cwd-tools.ts` for the custom-`cwd` variant.

## Custom cwd and tool factories

Critical rule:

- If `cwd !== process.cwd()` and `tools` is passed explicitly, do not use `readTool`, `bashTool`, or other prebuilt tool instances.
- Use factory functions such as `createCodingTools(cwd)`, `createReadTool(cwd)`, or `createBashTool(cwd)`.

Correct pattern:

```ts
import { createAgentSession, createCodingTools } from "@mariozechner/pi-coding-agent";

const cwd = "/path/to/project";

const { session } = await createAgentSession({
	cwd,
	tools: createCodingTools(cwd),
});
```

## Inline custom tools

Use `customTools` for a small number of local tools.

```ts
import { Type } from "@sinclair/typebox";
import { createAgentSession, defineTool } from "@mariozechner/pi-coding-agent";

const statusTool = defineTool({
	name: "status",
	label: "Status",
	description: "Return process uptime",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [{ type: "text", text: `Uptime: ${process.uptime()}s` }],
		details: {},
	}),
});

const { session } = await createAgentSession({
	customTools: [statusTool],
});
```

Use extensions instead when the tool should be shared, dynamically registered, or coordinated with events and commands.

See `assets/examples/custom-tool.ts`.

## File-mutating custom tools

Pi executes tool calls in parallel by default. If a custom tool mutates a file, serialize the whole read-modify-write region with `withFileMutationQueue()`.

```ts
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

return withFileMutationQueue(absolutePath, async () => {
	const current = await readFile(absolutePath, "utf8");
	const next = current.replace(oldText, newText);
	await writeFile(absolutePath, next, "utf8");
	return {
		content: [{ type: "text", text: "Updated file" }],
		details: {},
	};
});
```

Pass the real target path, ideally absolute.

## ResourceLoader overrides

Useful hooks on `DefaultResourceLoader`:

- `systemPromptOverride`
- `appendSystemPromptOverride`
- `skillsOverride`
- `promptsOverride`
- `agentsFilesOverride`
- `additionalExtensionPaths`
- `extensionFactories`

Example:

```ts
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
	agentsFilesOverride: (current) => ({
		agentsFiles: [
			...current.agentsFiles,
			{ path: "/virtual/AGENTS.md", content: "# App rules\n\n- Be concise" },
		],
	}),
});

await loader.reload();
```

See `assets/examples/resource-loader.ts`.

## Extensions

Use extensions when the integration needs:

- event hooks
- reusable custom tools
- slash commands
- custom UI bindings
- shared event bus behavior

Inline extension factory:

```ts
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
	extensionFactories: [
		(pi) => {
			pi.on("agent_start", () => {
				console.log("Agent starting");
			});
		},
	],
});

await loader.reload();
```

Extensions loaded through the resource loader can register tools, commands, handlers, and providers.

See `assets/examples/inline-extension.ts`.
