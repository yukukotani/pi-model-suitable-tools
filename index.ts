import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Type } from "typebox";
import { applyPatch } from "./src/apply-patch";
import {
  detectModelProfile,
  prepareApplyPatchArgs,
  toEditArgs,
  toGrepArgs,
  toReadArgs,
  toShellCommand,
  toWriteArgs,
  type ModelProfile,
} from "./src/tool-args";

const CLAUDE_ALIAS_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "LS"];
const CODEX_ALIAS_TOOLS = ["shell", "shell_command", "exec_command", "apply_patch"];
const CODEX_PROFILE_TOOLS = ["shell_command", "apply_patch"];
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const MANAGED_TOOLS = new Set([...CLAUDE_ALIAS_TOOLS, ...CODEX_ALIAS_TOOLS, ...BUILTIN_TOOLS]);

function timeoutSeconds(input: { timeout?: number; timeout_ms?: number }): number | undefined {
  if (typeof input.timeout === "number") return input.timeout;
  if (typeof input.timeout_ms === "number") return Math.max(1, Math.ceil(input.timeout_ms / 1000));
  return undefined;
}

async function resolveWorkdir(ctx: ExtensionContext, workdir: string | undefined): Promise<string | undefined> {
  if (!workdir) return undefined;
  const cwdRealPath = await realpath(ctx.cwd);
  const absolutePath = resolve(ctx.cwd, workdir);
  const workdirRealPath = await realpath(absolutePath);
  const rel = relative(cwdRealPath, workdirRealPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return workdirRealPath;
  throw new Error(`Working directory escapes workspace: ${workdir}`);
}

function registerClaudeAliases(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "Read",
      label: "Read",
      description: "Read file contents using Claude Code compatible arguments.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Path to the file to read" }),
        offset: Type.Optional(Type.Number({ description: "Line number to start reading from" })),
        limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return createReadToolDefinition(ctx.cwd).execute(id, toReadArgs(params), signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "Edit",
      label: "Edit",
      description: "Edit a file using Claude Code compatible exact string replacement arguments.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Path to the file to edit" }),
        old_string: Type.String({ description: "Exact text to replace" }),
        new_string: Type.String({ description: "Replacement text" }),
        replace_all: Type.Optional(Type.Boolean({ description: "Not supported by this adapter" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        if (params.replace_all) throw new Error("Edit.replace_all is not supported by the Pi edit adapter");
        return createEditToolDefinition(ctx.cwd).execute(id, toEditArgs(params), signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "Write",
      label: "Write",
      description: "Write file contents using Claude Code compatible arguments.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Path to the file to write" }),
        content: Type.String({ description: "Complete file contents" }),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return createWriteToolDefinition(ctx.cwd).execute(id, toWriteArgs(params), signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "Bash",
      label: "Bash",
      description: "Execute a bash command using Claude Code compatible arguments.",
      parameters: Type.Object({
        command: Type.String({ description: "Command to execute" }),
        description: Type.Optional(Type.String({ description: "Short command description" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
        run_in_background: Type.Optional(Type.Boolean({ description: "Runs through the shell when true" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        if (params.run_in_background) throw new Error("Bash.run_in_background is not supported by this adapter");
        return createBashToolDefinition(ctx.cwd).execute(
          id,
          { command: params.command, timeout: params.timeout },
          signal,
          onUpdate,
          ctx,
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "Grep",
      label: "Grep",
      description: "Search file contents using Claude Code compatible arguments.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Search pattern" }),
        path: Type.Optional(Type.String({ description: "File or directory to search" })),
        glob: Type.Optional(Type.String({ description: "Glob filter" })),
        case_sensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive search" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat pattern as regex" })),
        before_context: Type.Optional(Type.Number({ description: "Lines before each match" })),
        after_context: Type.Optional(Type.Number({ description: "Lines after each match" })),
        context: Type.Optional(Type.Number({ description: "Lines around each match" })),
        max_count: Type.Optional(Type.Number({ description: "Maximum matches" })),
        limit: Type.Optional(Type.Number({ description: "Maximum matches" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return createGrepToolDefinition(ctx.cwd).execute(id, toGrepArgs(params), signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "Glob",
      label: "Glob",
      description: "Find files by glob pattern using Claude Code compatible arguments.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Glob pattern" }),
        path: Type.Optional(Type.String({ description: "Directory to search" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return createFindToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "LS",
      label: "LS",
      description: "List directory contents using Claude Code compatible arguments.",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "Directory to list" })),
        limit: Type.Optional(Type.Number({ description: "Maximum entries" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return createLsToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx);
      },
    }),
  );
}

async function runShellAlias(
  id: string,
  input: {
    command?: string | string[];
    cmd?: string | string[];
    args?: string[];
    cwd?: string;
    workdir?: string;
    timeout?: number;
    timeout_ms?: number;
  },
  signal: AbortSignal | undefined,
  onUpdate: Parameters<ReturnType<typeof createBashToolDefinition>["execute"]>[3],
  ctx: ExtensionContext,
) {
  const command = toShellCommand(input);
  if (!command) throw new Error("Missing shell command");
  const workdir = await resolveWorkdir(ctx, input.cwd ?? input.workdir);
  const tool = createBashToolDefinition(
    ctx.cwd,
    workdir ? { spawnHook: (spawnContext) => ({ ...spawnContext, cwd: workdir }) } : undefined,
  );
  return tool.execute(id, { command, timeout: timeoutSeconds(input) }, signal, onUpdate, ctx);
}

function registerCodexAliases(pi: ExtensionAPI): void {
  const shellParameters = Type.Object({
    command: Type.Union([Type.String(), Type.Array(Type.String())], { description: "Command to execute" }),
    workdir: Type.Optional(Type.String({ description: "Working directory" })),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
    timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  });

  pi.registerTool(
    defineTool({
      name: "shell",
      label: "shell",
      description: "Execute a shell command using Codex compatible arguments.",
      parameters: shellParameters,
      async execute(id, params, signal, onUpdate, ctx) {
        return runShellAlias(id, params, signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "shell_command",
      label: "shell_command",
      description: "Execute a shell command using Codex shell_command compatible arguments.",
      parameters: shellParameters,
      async execute(id, params, signal, onUpdate, ctx) {
        return runShellAlias(id, params, signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "exec_command",
      label: "exec_command",
      description: "Execute a command with optional args using Codex exec_command compatible arguments.",
      parameters: Type.Object({
        command: Type.String({ description: "Executable or command" }),
        args: Type.Optional(Type.Array(Type.String(), { description: "Command arguments" })),
        workdir: Type.Optional(Type.String({ description: "Working directory" })),
        cwd: Type.Optional(Type.String({ description: "Working directory" })),
        timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
      }),
      async execute(id, params, signal, onUpdate, ctx) {
        return runShellAlias(id, params, signal, onUpdate, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "apply_patch",
      label: "apply_patch",
      description: "Apply a Codex-style patch to files in the current workspace.",
      parameters: Type.Object({
        input: Type.String({ description: "Complete patch text, from Begin Patch through End Patch" }),
      }),
      prepareArguments: prepareApplyPatchArgs,
      executionMode: "sequential",
      async execute(_id, params, signal, _onUpdate, ctx) {
        const result = await applyPatch(ctx.cwd, params.input, signal);
        return { content: [{ type: "text", text: result.summary }], details: result };
      },
    }),
  );
}

function toolsForProfile(profile: ModelProfile): string[] | undefined {
  if (profile === "claude") return CLAUDE_ALIAS_TOOLS;
  if (profile === "codex") return CODEX_PROFILE_TOOLS;
  return undefined;
}

function applyToolProfile(pi: ExtensionAPI, model: unknown, baseTools: string[]): void {
  const targetTools = toolsForProfile(detectModelProfile(model));
  const active = pi.getActiveTools();
  const preserved = active.filter((tool) => !MANAGED_TOOLS.has(tool));
  const next = targetTools ? [...preserved, ...targetTools] : [...preserved, ...baseTools];
  pi.setActiveTools([...new Set(next)]);
}

export default function modelOptimizedTools(pi: ExtensionAPI): void {
  registerClaudeAliases(pi);
  registerCodexAliases(pi);

  let baseTools: string[] = [];

  pi.on("session_start", (_event, ctx) => {
    baseTools = pi.getActiveTools().filter((tool) => !CLAUDE_ALIAS_TOOLS.includes(tool) && !CODEX_ALIAS_TOOLS.includes(tool));
    applyToolProfile(pi, ctx.model, baseTools);
  });

  pi.on("model_select", (event) => {
    applyToolProfile(pi, event.model, baseTools);
  });
}

export { applyPatch, parseApplyPatch } from "./src/apply-patch";
export { detectModelProfile, prepareApplyPatchArgs, toGrepArgs, toShellCommand } from "./src/tool-args";
