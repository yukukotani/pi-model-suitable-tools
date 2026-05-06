# pi-model-optimized-tools

Pi Extension that switches model-facing tool names to match the active model family without changing prompts.

## Behavior

- Claude models get Claude Code style aliases: `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `LS`.
- GPT/Codex models get Codex's default shell shape: `shell_command`, plus `apply_patch`.
- Alias tools delegate to Pi built-in tools where possible.
- `apply_patch` is implemented locally with Codex-style patch grammar.
- `shell`, `exec_command`, `TodoWrite`, `update_plan`, `Task`, `Agent`, and other tools without a matching Pi default tool are intentionally not registered.

## Usage

Run Pi with this extension:

```bash
pi -e ./index.ts
```

Or add it to Pi's extension search path, for example `.pi/extensions/model-optimized-tools.ts`.

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
```

## `apply_patch` Format

```text
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.ts
@@ function greet
-return "old";
+return "new";
*** Delete File: obsolete.txt
*** End Patch
```

Absolute paths and paths escaping the working directory are rejected.
