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
  type ToolDefinition,
  type ToolRenderResultOptions,
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

type ShellAliasInput = {
  command?: string | string[];
  cmd?: string | string[];
  args?: string[];
  cwd?: string;
  workdir?: string;
  timeout?: number;
  timeout_ms?: number;
};

type BashToolDefinition = ReturnType<typeof createBashToolDefinition>;
type AnyToolDefinition = ToolDefinition<any, any, any>;
type BuiltinToolName = "read" | "edit" | "write" | "bash" | "grep" | "find" | "ls";
type RenderContext = {
  args: any;
  cwd: string;
  [key: string]: any;
};
type RenderTheme = Parameters<NonNullable<BashToolDefinition["renderCall"]>>[1];

const renderDefinitions = new Map<string, AnyToolDefinition>();

function timeoutSeconds(input: { timeout?: number; timeout_ms?: number }): number | undefined {
  if (typeof input.timeout === "number") return input.timeout;
  if (typeof input.timeout_ms === "number") return Math.max(1, Math.ceil(input.timeout_ms / 1000));
  return undefined;
}

function createBuiltinRenderDefinition(name: BuiltinToolName, cwd: string): AnyToolDefinition {
  switch (name) {
    case "read":
      return createReadToolDefinition(cwd);
    case "edit":
      return createEditToolDefinition(cwd);
    case "write":
      return createWriteToolDefinition(cwd);
    case "bash":
      return createBashToolDefinition(cwd);
    case "grep":
      return createGrepToolDefinition(cwd);
    case "find":
      return createFindToolDefinition(cwd);
    case "ls":
      return createLsToolDefinition(cwd);
  }
}

function getRenderDefinition(name: BuiltinToolName, cwd: string): AnyToolDefinition {
  const key = `${name}:${cwd}`;
  const existing = renderDefinitions.get(key);
  if (existing) return existing;
  const definition = createBuiltinRenderDefinition(name, cwd);
  renderDefinitions.set(key, definition);
  return definition;
}

function toBashRenderArgs(input: ShellAliasInput): { command: string; timeout?: number } {
  return { command: toShellCommand(input), timeout: timeoutSeconds(input) };
}

function withRenderArgs(context: unknown, args: unknown): RenderContext {
  return { ...(context as RenderContext), args };
}

function replaceRenderedTitle(text: string, builtinName: BuiltinToolName, aliasLabel: string): string {
  return aliasLabel === builtinName ? text : text.replace(builtinName, aliasLabel);
}

function applyAliasToolTitle(component: unknown, builtinName: BuiltinToolName, aliasLabel: string): void {
  if (aliasLabel === builtinName || !component || typeof component !== "object") return;
  const target = component as { text?: unknown; setText?: (text: string) => void; children?: unknown[]; invalidate?: () => void };
  if (typeof target.text === "string") {
    const next = replaceRenderedTitle(target.text, builtinName, aliasLabel);
    if (next !== target.text) {
      if (typeof target.setText === "function") target.setText(next);
      else target.text = next;
    }
    return;
  }
  for (const child of target.children ?? []) applyAliasToolTitle(child, builtinName, aliasLabel);
  target.invalidate?.();
}

function renderAliasCall(
  name: BuiltinToolName,
  args: unknown,
  theme: RenderTheme,
  context: unknown,
  aliasLabel: string = name,
) {
  const renderContext = context as RenderContext;
  const renderCall = getRenderDefinition(name, renderContext.cwd).renderCall;
  if (!renderCall) throw new Error(`${name} renderer is unavailable`);
  const component = renderCall(args, theme, withRenderArgs(renderContext, args) as any);
  applyAliasToolTitle(component, name, aliasLabel);
  return component;
}

function renderAliasResult(
  name: BuiltinToolName,
  args: unknown,
  result: unknown,
  options: ToolRenderResultOptions,
  theme: RenderTheme,
  context: unknown,
  aliasLabel: string = name,
) {
  const renderContext = context as RenderContext;
  const renderResult = getRenderDefinition(name, renderContext.cwd).renderResult;
  if (!renderResult) throw new Error(`${name} renderer is unavailable`);
  const component = renderResult(
    result as Parameters<NonNullable<AnyToolDefinition["renderResult"]>>[0],
    options,
    theme,
    withRenderArgs(renderContext, args) as any,
  );
  applyAliasToolTitle((renderContext.state as { callComponent?: unknown } | undefined)?.callComponent, name, aliasLabel);
  applyAliasToolTitle(component, name, aliasLabel);
  return component;
}

function renderShellAliasCall(args: ShellAliasInput, theme: RenderTheme, context: unknown) {
  return renderAliasCall("bash", toBashRenderArgs(args), theme, context);
}

function renderShellAliasResult(result: unknown, options: ToolRenderResultOptions, theme: RenderTheme, context: unknown) {
  const args = toBashRenderArgs((context as RenderContext).args as ShellAliasInput);
  return renderAliasResult("bash", args, result, options, theme, context);
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
      renderCall: (params, theme, context) => renderAliasCall("read", toReadArgs(params), theme, context, "Read"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("read", toReadArgs(context.args), result, options, theme, context, "Read"),
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
      renderShell: "self",
      renderCall: (params, theme, context) => renderAliasCall("edit", toEditArgs(params), theme, context, "Edit"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("edit", toEditArgs(context.args), result, options, theme, context, "Edit"),
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
      renderCall: (params, theme, context) => renderAliasCall("write", toWriteArgs(params), theme, context, "Write"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("write", toWriteArgs(context.args), result, options, theme, context, "Write"),
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
      renderCall: (params, theme, context) => renderAliasCall("bash", toBashRenderArgs(params), theme, context, "Bash"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("bash", toBashRenderArgs(context.args), result, options, theme, context, "Bash"),
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
      renderCall: (params, theme, context) => renderAliasCall("grep", toGrepArgs(params), theme, context, "Grep"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("grep", toGrepArgs(context.args), result, options, theme, context, "Grep"),
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
      renderCall: (params, theme, context) => renderAliasCall("find", params, theme, context, "Glob"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("find", context.args, result, options, theme, context, "Glob"),
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
      renderCall: (params, theme, context) => renderAliasCall("ls", params, theme, context, "LS"),
      renderResult: (result, options, theme, context) =>
        renderAliasResult("ls", context.args, result, options, theme, context, "LS"),
      async execute(id, params, signal, onUpdate, ctx) {
        return createLsToolDefinition(ctx.cwd).execute(id, params, signal, onUpdate, ctx);
      },
    }),
  );
}

async function runShellAlias(
  id: string,
  input: ShellAliasInput,
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
      renderCall: renderShellAliasCall,
      renderResult: renderShellAliasResult,
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
      renderCall: renderShellAliasCall,
      renderResult: renderShellAliasResult,
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
      renderCall: renderShellAliasCall,
      renderResult: renderShellAliasResult,
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
