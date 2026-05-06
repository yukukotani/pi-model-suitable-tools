import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";

export interface ApplyPatchResult {
  changedFiles: string[];
  summary: string;
}

type HunkLine = {
  kind: "context" | "remove" | "add";
  text: string;
};

type Hunk = {
  header?: string;
  lines: HunkLine[];
  endOfFile: boolean;
};

type PatchOperation =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; hunks: Hunk[] };

interface PlannedWrite {
  kind: "write";
  mode: "create" | "replace";
  path: string;
  absolutePath: string;
  content: string;
}

interface PlannedDelete {
  kind: "delete";
  path: string;
  absolutePath: string;
}

type PlannedChange = PlannedWrite | PlannedDelete;

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const EOF_MARKER = "*** End of File";

function stripPatchEnvelope(input: string): string {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const begin = normalized.indexOf(BEGIN);
  const end = normalized.indexOf(END, begin + BEGIN.length);
  if (begin === -1 || end === -1) {
    throw new Error("Invalid patch: missing Begin Patch or End Patch marker");
  }
  return normalized.slice(begin, end + END.length);
}

function readPath(line: string, marker: string, lineNumber: number): string {
  const path = line.slice(marker.length).trim();
  if (!path) throw new Error(`Invalid patch line ${lineNumber}: missing path`);
  return path;
}

function isFileOp(line: string): boolean {
  return line.startsWith(ADD) || line.startsWith(DELETE) || line.startsWith(UPDATE) || line === END;
}

export function parseApplyPatch(input: string): PatchOperation[] {
  const text = stripPatchEnvelope(input);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== BEGIN) throw new Error("Invalid patch: first line must be Begin Patch");
  if (lines.at(-1) !== END) throw new Error("Invalid patch: last line must be End Patch");

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length - 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!line) {
      index++;
      continue;
    }

    if (line.startsWith(ADD)) {
      const path = readPath(line, ADD, lineNumber);
      index++;
      const content: string[] = [];
      while (index < lines.length - 1 && !isFileOp(lines[index] ?? "")) {
        const contentLine = lines[index] ?? "";
        if (!contentLine.startsWith("+")) {
          throw new Error(`Invalid add file line ${index + 1}: added lines must start with +`);
        }
        content.push(contentLine.slice(1));
        index++;
      }
      operations.push({ kind: "add", path, lines: content });
      continue;
    }

    if (line.startsWith(DELETE)) {
      operations.push({ kind: "delete", path: readPath(line, DELETE, lineNumber) });
      index++;
      continue;
    }

    if (line.startsWith(UPDATE)) {
      const path = readPath(line, UPDATE, lineNumber);
      index++;
      let moveTo: string | undefined;
      if ((lines[index] ?? "").startsWith(MOVE)) {
        moveTo = readPath(lines[index] ?? "", MOVE, index + 1);
        index++;
      }

      const hunks: Hunk[] = [];
      while (index < lines.length - 1 && !isFileOp(lines[index] ?? "")) {
        const hunkLine = lines[index] ?? "";
        if (!hunkLine.startsWith("@@")) {
          throw new Error(`Invalid update hunk line ${index + 1}: expected @@ header`);
        }
        const header = hunkLine.slice(2).trim() || undefined;
        index++;
        const hunkLines: HunkLine[] = [];
        let endOfFile = false;

        while (index < lines.length - 1) {
          const current = lines[index] ?? "";
          if (current.startsWith("@@") || isFileOp(current)) break;
          if (current === EOF_MARKER) {
            endOfFile = true;
            index++;
            break;
          }
          const prefix = current[0];
          if (prefix !== " " && prefix !== "-" && prefix !== "+") {
            throw new Error(`Invalid update hunk line ${index + 1}: expected space, -, or + prefix`);
          }
          hunkLines.push({
            kind: prefix === " " ? "context" : prefix === "-" ? "remove" : "add",
            text: current.slice(1),
          });
          index++;
        }

        if (hunkLines.length === 0 && !endOfFile) {
          throw new Error(`Invalid update hunk line ${lineNumber}: empty hunk`);
        }
        hunks.push({ header, lines: hunkLines, endOfFile });
      }

      if (hunks.length === 0 && !moveTo) {
        throw new Error(`Invalid update for ${path}: update must include hunks or Move to`);
      }
      operations.push({ kind: "update", path, moveTo, hunks });
      continue;
    }

    throw new Error(`Invalid patch line ${lineNumber}: expected file operation header`);
  }

  if (operations.length === 0) throw new Error("Invalid patch: no file operations");
  return operations;
}

function resolvePatchPath(cwd: string, patchPath: string): string {
  if (isAbsolute(patchPath)) throw new Error(`Absolute paths are not allowed: ${patchPath}`);
  const absolutePath = resolve(cwd, patchPath);
  const rel = relative(cwd, absolutePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes working directory: ${patchPath}`);
  }
  return absolutePath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

function splitContent(content: string): { lines: string[]; lineEnding: string; trailingNewline: boolean } {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const body = trailingNewline ? normalized.slice(0, -1) : normalized;
  return { lines: body ? body.split("\n") : [], lineEnding, trailingNewline };
}

function joinContent(lines: string[], lineEnding: string, trailingNewline: boolean): string {
  const body = lines.join(lineEnding);
  return trailingNewline && lines.length > 0 ? `${body}${lineEnding}` : body;
}

function hunkOldLines(hunk: Hunk): string[] {
  return hunk.lines.filter((line) => line.kind !== "add").map((line) => line.text);
}

function hunkNewLines(hunk: Hunk): string[] {
  return hunk.lines.filter((line) => line.kind !== "remove").map((line) => line.text);
}

function matchesAt(lines: string[], pattern: string[], index: number): boolean {
  if (index + pattern.length > lines.length) return false;
  for (let offset = 0; offset < pattern.length; offset++) {
    if (lines[index + offset] !== pattern[offset]) return false;
  }
  return true;
}

function findHeaderStart(lines: string[], header: string | undefined, startAt: number): number {
  if (!header) return startAt;
  const found = lines.findIndex((line, index) => index >= startAt && line.includes(header));
  return found === -1 ? startAt : found;
}

function findUniqueMatch(lines: string[], pattern: string[], startAt: number): number {
  let firstMatch = -1;
  for (let index = startAt; index <= lines.length - pattern.length; index++) {
    if (!matchesAt(lines, pattern, index)) continue;
    if (firstMatch !== -1) return -2;
    firstMatch = index;
  }
  return firstMatch;
}

function applyUpdateHunks(path: string, content: string, hunks: Hunk[]): string {
  const parsed = splitContent(content);
  const lines = [...parsed.lines];
  let cursor = 0;

  for (const hunk of hunks) {
    const oldLines = hunkOldLines(hunk);
    const newLines = hunkNewLines(hunk);
    const searchStart = hunk.endOfFile ? Math.max(0, lines.length - oldLines.length) : findHeaderStart(lines, hunk.header, cursor);
    let matchIndex: number;

    if (oldLines.length === 0) {
      matchIndex = hunk.endOfFile ? lines.length : searchStart;
    } else {
      matchIndex = findUniqueMatch(lines, oldLines, searchStart);
    }

    if (matchIndex === -1) throw new Error(`Could not find hunk target in ${path}`);
    if (matchIndex === -2) throw new Error(`Ambiguous hunk target in ${path}`);

    lines.splice(matchIndex, oldLines.length, ...newLines);
    cursor = matchIndex + newLines.length;
  }

  return joinContent(lines, parsed.lineEnding, parsed.trailingNewline);
}

function isInsideCwd(cwdRealPath: string, targetRealPath: string): boolean {
  const rel = relative(cwdRealPath, targetRealPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function assertExistingPathInsideCwd(cwdRealPath: string, absolutePath: string, patchPath: string): Promise<void> {
  const stat = await lstat(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`Symlink paths are not allowed: ${patchPath}`);
  const targetRealPath = await realpath(absolutePath);
  if (!isInsideCwd(cwdRealPath, targetRealPath)) throw new Error(`Path escapes working directory: ${patchPath}`);
}

async function assertCreatablePathInsideCwd(cwdRealPath: string, absolutePath: string, patchPath: string): Promise<void> {
  let ancestor = dirname(absolutePath);
  while (!(await fileExists(ancestor))) {
    const next = dirname(ancestor);
    if (next === ancestor) throw new Error(`Cannot resolve parent directory for: ${patchPath}`);
    ancestor = next;
  }
  const ancestorRealPath = await realpath(ancestor);
  if (!isInsideCwd(cwdRealPath, ancestorRealPath)) throw new Error(`Path escapes working directory: ${patchPath}`);
}

async function planChanges(cwd: string, operations: PatchOperation[], signal?: AbortSignal): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = [];
  const plannedPaths = new Set<string>();
  const cwdRealPath = await realpath(cwd);

  for (const operation of operations) {
    assertNotAborted(signal);
    const absolutePath = resolvePatchPath(cwd, operation.path);

    if (plannedPaths.has(absolutePath)) {
      throw new Error(`Patch modifies the same path more than once: ${operation.path}`);
    }

    if (operation.kind === "add") {
      if (await fileExists(absolutePath)) {
        throw new Error(`Cannot add file that already exists: ${operation.path}`);
      }
      await assertCreatablePathInsideCwd(cwdRealPath, absolutePath, operation.path);
      plannedPaths.add(absolutePath);
      changes.push({
        kind: "write",
        mode: "create",
        path: operation.path,
        absolutePath,
        content: operation.lines.length === 0 ? "" : `${operation.lines.join("\n")}\n`,
      });
      continue;
    }

    if (operation.kind === "delete") {
      if (!(await fileExists(absolutePath))) throw new Error(`Cannot delete missing file: ${operation.path}`);
      await assertExistingPathInsideCwd(cwdRealPath, absolutePath, operation.path);
      plannedPaths.add(absolutePath);
      changes.push({ kind: "delete", path: operation.path, absolutePath });
      continue;
    }

    if (!(await fileExists(absolutePath))) throw new Error(`Cannot update missing file: ${operation.path}`);
    await assertExistingPathInsideCwd(cwdRealPath, absolutePath, operation.path);
    const current = await readFile(absolutePath, "utf8");
    assertNotAborted(signal);
    const next = applyUpdateHunks(operation.path, current, operation.hunks);
    const targetPath = operation.moveTo ?? operation.path;
    const targetAbsolutePath = resolvePatchPath(cwd, targetPath);
    if (operation.moveTo && plannedPaths.has(targetAbsolutePath)) {
      throw new Error(`Patch modifies the same path more than once: ${operation.moveTo}`);
    }
    if (operation.moveTo && (await fileExists(targetAbsolutePath))) {
      throw new Error(`Cannot move to existing file: ${operation.moveTo}`);
    }
    if (operation.moveTo) await assertCreatablePathInsideCwd(cwdRealPath, targetAbsolutePath, operation.moveTo);
    plannedPaths.add(absolutePath);
    plannedPaths.add(targetAbsolutePath);
    changes.push({
      kind: "write",
      mode: operation.moveTo ? "create" : "replace",
      path: targetPath,
      absolutePath: targetAbsolutePath,
      content: next,
    });
    if (operation.moveTo) changes.push({ kind: "delete", path: operation.path, absolutePath });
  }

  return changes;
}

async function writeAtomic(change: PlannedWrite, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  await mkdir(dirname(change.absolutePath), { recursive: true });
  const tempPath = resolve(dirname(change.absolutePath), `.tmp-${randomUUID()}`);
  try {
    await writeFile(tempPath, change.content, { encoding: "utf8", flag: "wx" });
    assertNotAborted(signal);
    if (change.mode === "create") {
      await link(tempPath, change.absolutePath);
      await unlink(tempPath);
    } else {
      await rename(tempPath, change.absolutePath);
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function withMutationQueues(paths: string[], fn: () => Promise<void>): Promise<void> {
  const [first, ...rest] = [...new Set(paths)].sort();
  if (!first) return fn();
  return withFileMutationQueue(first, () => withMutationQueues(rest, fn));
}

function operationPaths(cwd: string, operations: PatchOperation[]): string[] {
  const paths: string[] = [];
  for (const operation of operations) {
    paths.push(resolvePatchPath(cwd, operation.path));
    if (operation.kind === "update" && operation.moveTo) paths.push(resolvePatchPath(cwd, operation.moveTo));
  }
  return paths;
}

export async function applyPatch(cwd: string, input: string, signal?: AbortSignal): Promise<ApplyPatchResult> {
  const operations = parseApplyPatch(input);
  const paths = operationPaths(cwd, operations);
  let changes: PlannedChange[] = [];

  await withMutationQueues(paths, async () => {
    changes = await planChanges(cwd, operations, signal);
    for (const change of changes) {
      assertNotAborted(signal);
      if (change.kind === "delete") {
        await rm(change.absolutePath, { force: false });
      } else {
        await writeAtomic(change, signal);
      }
    }
  });

  const changedFiles = [...new Set(changes.map((change) => change.path))];
  return {
    changedFiles,
    summary: `Applied patch to ${changedFiles.length} file(s): ${changedFiles.join(", ")}`,
  };
}
