export type ModelProfile = "claude" | "codex" | "unknown";

export function detectModelProfile(model: unknown): ModelProfile {
  if (!model || typeof model !== "object") return "unknown";
  const record = model as Record<string, unknown>;
  const values = [record.provider, record.id, record.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (values.includes("claude") || values.includes("anthropic")) return "claude";
  if (values.includes("codex") || values.includes("gpt") || /\bo\d/.test(values) || values.includes("openai")) {
    return "codex";
  }
  return "unknown";
}

export function toReadArgs(input: { file_path?: string; path?: string; offset?: number; limit?: number }) {
  return { path: input.file_path ?? input.path ?? "", offset: input.offset, limit: input.limit };
}

export function toEditArgs(input: {
  file_path?: string;
  path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}) {
  return {
    path: input.file_path ?? input.path ?? "",
    edits: [{ oldText: input.old_string ?? "", newText: input.new_string ?? "" }],
  };
}

export function toWriteArgs(input: { file_path?: string; path?: string; content?: string }) {
  return { path: input.file_path ?? input.path ?? "", content: input.content ?? "" };
}

export function toGrepArgs(input: {
  pattern: string;
  path?: string;
  glob?: string;
  case_sensitive?: boolean;
  regex?: boolean;
  before_context?: number;
  after_context?: number;
  context?: number;
  limit?: number;
  max_count?: number;
}) {
  const before = input.before_context ?? 0;
  const after = input.after_context ?? 0;
  return {
    pattern: input.pattern,
    path: input.path,
    glob: input.glob,
    ignoreCase: input.case_sensitive === undefined ? undefined : !input.case_sensitive,
    literal: input.regex === undefined ? undefined : !input.regex,
    context: input.context ?? (Math.max(before, after) || undefined),
    limit: input.limit ?? input.max_count,
  };
}

export function toShellCommand(input: {
  command?: string | string[];
  cmd?: string | string[];
  args?: string[];
}) {
  const commandValue = input.command ?? input.cmd ?? "";
  const command = Array.isArray(commandValue) ? commandValue.map(quoteShellArg).join(" ") : commandValue;
  const args = Array.isArray(input.args) && input.args.length > 0 ? ` ${input.args.map(quoteShellArg).join(" ")}` : "";
  const body = `${command}${args}`.trim();
  return body;
}

export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function prepareApplyPatchArgs(args: unknown): { input: string } {
  if (typeof args === "string") return { input: args };
  if (!args || typeof args !== "object") return { input: "" };
  const record = args as Record<string, unknown>;
  const input = record.input ?? record.patch;
  return { input: typeof input === "string" ? input : "" };
}
