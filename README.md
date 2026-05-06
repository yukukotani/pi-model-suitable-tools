# pi-model-suitable-tools

Pi Extension that switches model-facing tool names to match the active model family without changing prompts.

## Motivation

Different model families are trained around different tool shapes. As Cursor notes in [their article](https://cursor.com/en-US/blog/continually-improving-agent-harness#customizing-the-harness-for-different-models), giving each model the tool format it already expects can reduce unnecessary reasoning and mistakes. This extension applies that idea to Pi by exposing model-appropriate tool names while keeping the underlying behavior consistent.

## Usage

Install this package into Pi:

```bash
pi install pi-model-suitable-tool
```

For project-local installation, use Pi's local settings flag:

```bash
pi install -l pi-model-suitable-tools
```

## Behavior

- Claude models get Claude Code style aliases: `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `LS`.
- GPT/Codex models get Codex's default shell shape: `shell_command`, plus `apply_patch`.
- Alias tools delegate to Pi built-in tools where possible.
- `apply_patch` is implemented locally with Codex-style patch grammar.

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
```

Run Pi with the extension temporarily during development:

```bash
pi -e ./
```
