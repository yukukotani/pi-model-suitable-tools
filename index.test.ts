import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import modelSuitableTools, { applyPatch, parseApplyPatch, prepareApplyPatchArgs, toGrepArgs, toShellCommand } from "./index";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-model-tools-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("apply_patch", () => {
  test("parses add, update, and delete operations", () => {
    const operations = parseApplyPatch(`*** Begin Patch
*** Add File: hello.txt
+Hello
*** Update File: src/app.ts
@@ greet
-old
+new
*** Delete File: old.txt
*** End Patch`);

    expect(operations).toHaveLength(3);
  });

  test("adds a file", async () => {
    await withTempDir(async (dir) => {
      const result = await applyPatch(
        dir,
        `*** Begin Patch
*** Add File: hello.txt
+Hello world
*** End Patch`,
      );

      expect(result.changedFiles).toEqual(["hello.txt"]);
      expect(await readFile(join(dir, "hello.txt"), "utf8")).toBe("Hello world\n");
    });
  });

  test("updates a file with context", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "app.ts"), "function greet() {\n  return 'old';\n}\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: app.ts
@@ function greet
 function greet() {
-  return 'old';
+  return 'new';
 }
*** End Patch`,
      );

      expect(await readFile(join(dir, "app.ts"), "utf8")).toBe("function greet() {\n  return 'new';\n}\n");
    });
  });

  test("moves an updated file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "old.ts"), "export const value = 'old';\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
@@
-export const value = 'old';
+export const value = 'new';
*** End Patch`,
      );

      expect(await Bun.file(join(dir, "old.ts")).exists()).toBe(false);
      expect(await readFile(join(dir, "new.ts"), "utf8")).toBe("export const value = 'new';\n");
    });
  });

  test("rejects symlink update paths", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "target.txt"), "old\n", "utf8");
      await symlink(join(dir, "target.txt"), join(dir, "link.txt"));

      await expect(
        applyPatch(
          dir,
          `*** Begin Patch
*** Update File: link.txt
@@
-old
+new
*** End Patch`,
        ),
      ).rejects.toThrow("Symlink paths are not allowed");
    });
  });

  test("rejects paths outside cwd", async () => {
    await withTempDir(async (dir) => {
      await expect(
        applyPatch(
          dir,
          `*** Begin Patch
*** Add File: ../escape.txt
+nope
*** End Patch`,
        ),
      ).rejects.toThrow("escapes working directory");
    });
  });
});

describe("argument adapters", () => {
  test("normalizes codex shell_command strings", () => {
    expect(toShellCommand({ command: " git status --short " })).toBe("git status --short");
  });

  test("maps Claude grep fields to Pi grep fields", () => {
    expect(toGrepArgs({ pattern: "foo", case_sensitive: false, regex: false, before_context: 1, after_context: 2 })).toEqual({
      pattern: "foo",
      path: undefined,
      glob: undefined,
      ignoreCase: true,
      literal: true,
      context: 2,
      limit: undefined,
    });
  });

  test("normalizes apply_patch arguments", () => {
    expect(prepareApplyPatchArgs("patch")).toEqual({ input: "patch" });
    expect(prepareApplyPatchArgs({ patch: "patch" })).toEqual({ input: "patch" });
  });
});

describe("tool registration", () => {
  function registeredTools() {
    const tools: Array<{ name: string; renderCall?: unknown; renderResult?: unknown; renderShell?: unknown }> = [];
    modelSuitableTools({
      registerTool(tool: { name: string; renderCall?: unknown; renderResult?: unknown; renderShell?: unknown }) {
        tools.push(tool);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
      on() {},
    } as any);
    return tools;
  }

  test("Claude aliases reuse built-in renderers", () => {
    const tools = registeredTools();

    for (const name of ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "LS"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.renderCall).toBeFunction();
      expect(tool?.renderResult).toBeFunction();
    }
    expect(tools.find((candidate) => candidate.name === "Edit")?.renderShell).toBe("self");
  });

  test("Codex aliases only register shell_command and apply_patch", () => {
    const tools = registeredTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("shell_command");
    expect(names).toContain("apply_patch");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("exec_command");
  });

  test("Claude aliases render their alias tool names", () => {
    const tools = registeredTools();
    const theme = {
      fg: (_name: string, text: string) => text,
      bg: (_name: string, text: string) => text,
      bold: (text: string) => text,
    };
    const context = {
      cwd: process.cwd(),
      args: {},
      toolCallId: "test",
      invalidate() {},
      lastComponent: undefined,
      state: {},
      executionStarted: false,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: true,
      isError: false,
    };

    const cases = [
      { name: "Read", args: { file_path: "package.json" }, expected: "Read package.json" },
      { name: "Glob", args: { pattern: "*.ts" }, expected: "Glob *.ts" },
      { name: "LS", args: { path: "." }, expected: "LS ." },
    ];

    for (const item of cases) {
      const tool = tools.find((candidate) => candidate.name === item.name);
      const component = (tool?.renderCall as any)(item.args, theme, { ...context, args: item.args });
      expect(component.render(120).join("\n")).toContain(item.expected);
    }
  });
});
