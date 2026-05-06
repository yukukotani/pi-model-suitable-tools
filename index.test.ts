import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
@@ function greet() {
-  return 'old';
+  return 'new';
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

  test("summarizes changes in Codex category order", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "delete.txt"), "delete\n", "utf8");
      await writeFile(join(dir, "modify.txt"), "old\n", "utf8");

      const result = await applyPatch(
        dir,
        `*** Begin Patch
*** Delete File: delete.txt
*** Update File: modify.txt
@@
-old
+new
*** Add File: add.txt
+add
*** End Patch`,
      );

      expect(result.summary).toBe("Success. Updated the following files:\nA add.txt\nM modify.txt\nD delete.txt\n");
    });
  });

  test("updates through symlink paths", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "target.txt"), "old\n", "utf8");
      await symlink(join(dir, "target.txt"), join(dir, "link.txt"));

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: link.txt
@@
-old
+new
*** End Patch`,
      );

      expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new\n");
    });
  });

  test("allows paths outside cwd", async () => {
    await withTempDir(async (dir) => {
      const outside = join(dir, "..", `escape-${Date.now()}.txt`);
      try {
        await applyPatch(
          dir,
          `*** Begin Patch
*** Add File: ${outside}
+outside
*** End Patch`,
        );

        expect(await readFile(outside, "utf8")).toBe("outside\n");
      } finally {
        await rm(outside, { force: true });
      }
    });
  });

  test("overwrites existing add targets", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "duplicate.txt"), "old\n", "utf8");

      const result = await applyPatch(
        dir,
        `*** Begin Patch
*** Add File: duplicate.txt
+new
*** End Patch`,
      );

      expect(result.summary).toBe("Success. Updated the following files:\nA duplicate.txt\n");
      expect(await readFile(join(dir, "duplicate.txt"), "utf8")).toBe("new\n");
    });
  });

  test("overwrites existing move destinations", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "old.txt"), "from\n", "utf8");
      await writeFile(join(dir, "new.txt"), "existing\n", "utf8");

      const result = await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: old.txt
*** Move to: new.txt
@@
-from
+to
*** End Patch`,
      );

      expect(result.changedFiles).toEqual(["new.txt"]);
      expect(await Bun.file(join(dir, "old.txt")).exists()).toBe(false);
      expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("to\n");
    });
  });

  test("rejects moves to the same path", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "same.txt"), "old\n", "utf8");

      await expect(
        applyPatch(
          dir,
          `*** Begin Patch
*** Update File: same.txt
*** Move to: ./same.txt
@@
-old
+new
*** End Patch`,
        ),
      ).rejects.toThrow("Cannot move file to itself");
      expect(await readFile(join(dir, "same.txt"), "utf8")).toBe("old\n");
    });
  });

  test("applies repeated updates to the latest planned contents", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "repeat.txt"), "one\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: repeat.txt
@@
-one
+two
*** Update File: repeat.txt
@@
-two
+three
*** End Patch`,
      );

      expect(await readFile(join(dir, "repeat.txt"), "utf8")).toBe("three\n");
    });
  });

  test("accepts first update chunk without @@", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "file.txt"), "import foo\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: file.txt
 import foo
+bar
*** End Patch`,
      );

      expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("import foo\nbar\n");
    });
  });

  test("uses fuzzy whitespace and unicode punctuation matching", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "unicode.txt"), "import asyncio  # local import – avoids top‑level dep\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: unicode.txt
@@
-import asyncio  # local import - avoids top-level dep
+import asyncio  # ok
*** End Patch`,
      );

      expect(await readFile(join(dir, "unicode.txt"), "utf8")).toBe("import asyncio  # ok\n");
    });
  });

  test("appends trailing newline on update", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "no-newline.txt"), "old", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: no-newline.txt
@@
-old
+new
*** End Patch`,
      );

      expect(await readFile(join(dir, "no-newline.txt"), "utf8")).toBe("new\n");
    });
  });

  test("anchors hunks at end of file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "tail.txt"), "first\nlast\n", "utf8");

      await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: tail.txt
@@
-last
+end
*** End of File
*** End Patch`,
      );

      expect(await readFile(join(dir, "tail.txt"), "utf8")).toBe("first\nend\n");
    });
  });

  test("accepts lenient heredoc wrapped patches", async () => {
    await withTempDir(async (dir) => {
      await applyPatch(
        dir,
        `<<'EOF'
*** Begin Patch
*** Add File: heredoc.txt
+wrapped
*** End Patch
EOF`,
      );

      expect(await readFile(join(dir, "heredoc.txt"), "utf8")).toBe("wrapped\n");
    });
  });

  test("rejects move-only updates", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "old.txt"), "same\n", "utf8");

      await expect(
        applyPatch(
          dir,
          `*** Begin Patch
*** Update File: old.txt
*** Move to: new.txt
*** End Patch`,
        ),
      ).rejects.toThrow("update must include hunks");
    });
  });

  test("rejects empty patches at apply time", async () => {
    await withTempDir(async (dir) => {
      expect(parseApplyPatch("*** Begin Patch\n*** End Patch")).toEqual([]);
      await expect(applyPatch(dir, "*** Begin Patch\n*** End Patch")).rejects.toThrow("No files were modified");
    });
  });

  test("rejects directory deletes", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "subdir"));

      await expect(
        applyPatch(
          dir,
          `*** Begin Patch
*** Delete File: subdir
*** End Patch`,
        ),
      ).rejects.toThrow("Cannot delete directory");
    });
  });

  test("does not extract patches from surrounding prose", () => {
    expect(() =>
      parseApplyPatch(`before
*** Begin Patch
*** Add File: prose.txt
+nope
*** End Patch`),
    ).toThrow("first line");
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
    const tools: Array<{ name: string; description?: string; renderCall?: unknown; renderResult?: unknown; renderShell?: unknown }> = [];
    modelSuitableTools({
      registerTool(tool: { name: string; description?: string; renderCall?: unknown; renderResult?: unknown; renderShell?: unknown }) {
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

    for (const name of ["Read", "Edit", "Write", "Bash", "Grep", "Glob"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.renderCall).toBeFunction();
      expect(tool?.renderResult).toBeFunction();
    }
    expect(tools.find((candidate) => candidate.name === "LS")).toBeUndefined();
    expect(tools.find((candidate) => candidate.name === "Edit")?.renderShell).toBe("self");
  });

  test("aliases use source tool descriptions", () => {
    const tools = registeredTools();
    const description = (name: string) => tools.find((candidate) => candidate.name === name)?.description;

    expect(description("Read")).toBe("Read a file from the local filesystem.");
    expect(description("Edit")).toBe("A tool for editing files");
    expect(description("Write")).toBe("Write a file to the local filesystem.");
    expect(description("Bash")).toBe("Run shell command");
    expect(description("Grep")).toContain("A powerful search tool built on ripgrep");
    expect(description("Glob")).toBe(`- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`);
    expect(description("shell_command")).toBe(`Runs a shell command and returns its output.
- Always set the \`workdir\` param when using the shell_command function. Do not use \`cd\` unless absolutely necessary.`);
    expect(description("apply_patch")).toContain("Use the `apply_patch` shell command to edit files.");
    expect(description("apply_patch")).toContain("File references can only be relative, NEVER ABSOLUTE.");
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
    ];

    for (const item of cases) {
      const tool = tools.find((candidate) => candidate.name === item.name);
      const component = (tool?.renderCall as any)(item.args, theme, { ...context, args: item.args });
      expect(component.render(120).join("\n")).toContain(item.expected);
    }
  });
});
