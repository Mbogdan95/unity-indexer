# CLI Install/Uninstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `install` and `uninstall` subcommands to unity-indexer CLI for registering/removing the MCP server in Claude Code settings across four scopes.

**Architecture:** Two new files in `src/cli/` — a settings manager for reading/writing Claude Code JSON settings, and a CLI parser that dispatches commands. Entry point (`src/index.ts`) checks argv before starting the MCP server. No new dependencies.

**Tech Stack:** Node.js fs/path, JSON read/write, vitest for tests.

---

## File Structure

### New Files

| File                         | Responsibility                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `src/cli/settings.ts`        | Resolve scope to file path, install/uninstall MCP server entry in Claude Code settings JSON |
| `src/cli/cli.ts`             | Parse argv into a discriminated union action, print help/version                            |
| `tests/cli/settings.test.ts` | Settings manager unit tests using temp dirs                                                 |
| `tests/cli/cli.test.ts`      | CLI parser unit tests                                                                       |

### Modified Files

| File           | Changes                                    |
| -------------- | ------------------------------------------ |
| `src/index.ts` | Dispatch to CLI before starting MCP server |

---

### Task 1: Settings Manager — Types and Scope Resolution

**Files:**

- Create: `src/cli/settings.ts`
- Create: `tests/cli/settings.test.ts`

- [ ] **Step 1: Write failing tests for scope resolution**

Create `tests/cli/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSettingsPath } from "../src/cli/settings.js";
import { join } from "path";
import { homedir } from "os";

describe("resolveSettingsPath", () => {
  it("resolves global scope to ~/.claude/settings.json", () => {
    const result = resolveSettingsPath("global");
    expect(result).toBe(join(homedir(), ".claude", "settings.json"));
  });

  it("resolves local scope to ~/.claude/settings.local.json", () => {
    const result = resolveSettingsPath("local");
    expect(result).toBe(join(homedir(), ".claude", "settings.local.json"));
  });

  it("resolves project scope to cwd/.claude/settings.json", () => {
    const result = resolveSettingsPath("project", "/tmp/my-project");
    expect(result).toBe(join("/tmp/my-project", ".claude", "settings.json"));
  });

  it("resolves project-local scope to cwd/.claude/settings.local.json", () => {
    const result = resolveSettingsPath("project-local", "/tmp/my-project");
    expect(result).toBe(join("/tmp/my-project", ".claude", "settings.local.json"));
  });

  it("uses process.cwd() for project scope when no cwd provided", () => {
    const result = resolveSettingsPath("project");
    expect(result).toBe(join(process.cwd(), ".claude", "settings.json"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: FAIL — `resolveSettingsPath` not found.

- [ ] **Step 3: Implement scope resolution**

Create `src/cli/settings.ts`:

```ts
import { join } from "path";
import { homedir } from "os";

export type Scope = "global" | "local" | "project" | "project-local";

export const VALID_SCOPES: readonly Scope[] = ["global", "local", "project", "project-local"];

export function resolveSettingsPath(scope: Scope, cwd?: string): string {
  const projectDir = cwd ?? process.cwd();
  switch (scope) {
    case "global":
      return join(homedir(), ".claude", "settings.json");
    case "local":
      return join(homedir(), ".claude", "settings.local.json");
    case "project":
      return join(projectDir, ".claude", "settings.json");
    case "project-local":
      return join(projectDir, ".claude", "settings.local.json");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/settings.ts tests/cli/settings.test.ts
git commit -m "feat: add settings scope resolution for Claude Code config"
```

---

### Task 2: Settings Manager — Install Function

**Files:**

- Modify: `src/cli/settings.ts`
- Modify: `tests/cli/settings.test.ts`

- [ ] **Step 1: Write failing tests for install**

Append to `tests/cli/settings.test.ts`:

```ts
import { resolveSettingsPath, installServer, type Scope } from "../src/cli/settings.js";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";

describe("installServer", () => {
  function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "unity-indexer-test-"));
  }

  it("creates settings file when it does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, ".claude", "settings.json");

    installServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("preserves existing mcpServers entries", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      }),
    );

    installServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("preserves non-mcpServers settings", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(filePath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));

    installServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.permissions).toEqual({ allow: ["Bash(ls)"] });
  });

  it("overwrites existing unity-indexer entry (idempotent)", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          "unity-indexer": { command: "old", args: ["old"] },
        },
      }),
    );

    installServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("creates parent directories when they do not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "nested", "deep", "settings.json");

    installServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: FAIL — `installServer` not exported.

- [ ] **Step 3: Implement installServer**

Add to `src/cli/settings.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

interface McpServerEntry {
  command: string;
  args: string[];
}

interface SettingsJson {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

const UNITY_INDEXER_ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "unity-indexer"],
};

function readSettings(filePath: string): SettingsJson {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SettingsJson;
}

function writeSettings(filePath: string, settings: SettingsJson): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
}

export function installServer(filePath: string): void {
  const settings = readSettings(filePath);
  if (settings.mcpServers === undefined) {
    settings.mcpServers = {};
  }
  settings.mcpServers["unity-indexer"] = UNITY_INDEXER_ENTRY;
  writeSettings(filePath, settings);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/settings.ts tests/cli/settings.test.ts
git commit -m "feat: add installServer for Claude Code settings"
```

---

### Task 3: Settings Manager — Uninstall Function

**Files:**

- Modify: `src/cli/settings.ts`
- Modify: `tests/cli/settings.test.ts`

- [ ] **Step 1: Write failing tests for uninstall**

Append to `tests/cli/settings.test.ts`:

```ts
import {
  resolveSettingsPath,
  installServer,
  uninstallServer,
  type Scope,
} from "../src/cli/settings.js";

describe("uninstallServer", () => {
  function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "unity-indexer-test-"));
  }

  it("removes unity-indexer entry from mcpServers", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          "unity-indexer": { command: "npx", args: ["-y", "unity-indexer"] },
          "other-server": { command: "other", args: [] },
        },
      }),
    );

    uninstallServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toBeUndefined();
    expect(content.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
  });

  it("preserves non-mcpServers settings", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        permissions: { allow: [] },
        mcpServers: {
          "unity-indexer": { command: "npx", args: ["-y", "unity-indexer"] },
        },
      }),
    );

    uninstallServer(filePath);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.permissions).toEqual({ allow: [] });
  });

  it("throws when settings file does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "nonexistent.json");

    expect(() => uninstallServer(filePath)).toThrow("Settings file not found");
  });

  it("throws when unity-indexer is not in mcpServers", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      }),
    );

    expect(() => uninstallServer(filePath)).toThrow("unity-indexer is not registered");
  });

  it("throws when mcpServers key does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(filePath, JSON.stringify({ permissions: {} }));

    expect(() => uninstallServer(filePath)).toThrow("unity-indexer is not registered");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: FAIL — `uninstallServer` not exported.

- [ ] **Step 3: Implement uninstallServer**

Add to `src/cli/settings.ts`:

```ts
export function uninstallServer(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Settings file not found: ${filePath}`);
  }
  const settings = readSettings(filePath);
  if (
    settings.mcpServers === undefined ||
    !Object.prototype.hasOwnProperty.call(settings.mcpServers, "unity-indexer")
  ) {
    throw new Error("unity-indexer is not registered in this settings file");
  }
  delete settings.mcpServers["unity-indexer"];
  writeSettings(filePath, settings);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/settings.test.ts`

Expected: All 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/settings.ts tests/cli/settings.test.ts
git commit -m "feat: add uninstallServer for Claude Code settings"
```

---

### Task 4: CLI Parser

**Files:**

- Create: `src/cli/cli.ts`
- Create: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write failing tests for CLI parser**

Create `tests/cli/cli.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli/cli.js";

describe("parseArgs", () => {
  it("returns help action for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("returns help action for -h", () => {
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("returns version action for --version", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("returns version action for -v", () => {
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("returns install action with default global scope", () => {
    expect(parseArgs(["install"])).toEqual({ kind: "install", scope: "global" });
  });

  it("returns install action with specified scope", () => {
    expect(parseArgs(["install", "--scope", "project"])).toEqual({
      kind: "install",
      scope: "project",
    });
  });

  it("returns install action with project-local scope", () => {
    expect(parseArgs(["install", "--scope", "project-local"])).toEqual({
      kind: "install",
      scope: "project-local",
    });
  });

  it("returns help action for install --help", () => {
    expect(parseArgs(["install", "--help"])).toEqual({ kind: "help" });
  });

  it("returns uninstall action with default global scope", () => {
    expect(parseArgs(["uninstall"])).toEqual({ kind: "uninstall", scope: "global" });
  });

  it("returns uninstall action with specified scope", () => {
    expect(parseArgs(["uninstall", "--scope", "local"])).toEqual({
      kind: "uninstall",
      scope: "local",
    });
  });

  it("throws for invalid scope", () => {
    expect(() => parseArgs(["install", "--scope", "invalid"])).toThrow("Invalid scope");
  });

  it("throws for --scope without value", () => {
    expect(() => parseArgs(["install", "--scope"])).toThrow("--scope requires a value");
  });

  it("returns server action for no args", () => {
    expect(parseArgs([])).toEqual({ kind: "server", projectRoot: undefined });
  });

  it("returns server action with project root for unknown positional", () => {
    expect(parseArgs(["/some/path"])).toEqual({ kind: "server", projectRoot: "/some/path" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/cli.test.ts`

Expected: FAIL — `parseArgs` not found.

- [ ] **Step 3: Implement CLI parser**

Create `src/cli/cli.ts`:

```ts
import type { Scope } from "./settings.js";
import { VALID_SCOPES } from "./settings.js";

export type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "install"; scope: Scope }
  | { kind: "uninstall"; scope: Scope }
  | { kind: "server"; projectRoot: string | undefined };

function parseScope(args: string[], index: number): Scope {
  const scopeIndex = args.indexOf("--scope", index);
  if (scopeIndex === -1) {
    return "global";
  }
  const value = args[scopeIndex + 1];
  if (value === undefined) {
    throw new Error("--scope requires a value");
  }
  if (!VALID_SCOPES.includes(value as Scope)) {
    throw new Error(`Invalid scope "${value}". Valid scopes: ${VALID_SCOPES.join(", ")}`);
  }
  return value as Scope;
}

export function parseArgs(args: string[]): CliAction {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { kind: "version" };
  }

  const command = args[0];

  if (command === "install") {
    return { kind: "install", scope: parseScope(args, 1) };
  }
  if (command === "uninstall") {
    return { kind: "uninstall", scope: parseScope(args, 1) };
  }

  return { kind: "server", projectRoot: command };
}

export function getHelpText(version: string): string {
  return `unity-indexer v${version}
Unity-specialized MCP server for token-efficient code exploration

Usage:
  unity-indexer [project-root]      Start MCP server
  unity-indexer install [options]   Register in Claude Code settings
  unity-indexer uninstall [options] Remove from Claude Code settings

Options:
  --scope <scope>  Target scope (default: global)
                   global        ~/.claude/settings.json
                   local         ~/.claude/settings.local.json
                   project       .claude/settings.json
                   project-local .claude/settings.local.json
  --help, -h       Show this help
  --version, -v    Show version`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/cli.test.ts`

Expected: All 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/cli.ts tests/cli/cli.test.ts
git commit -m "feat: add CLI argument parser with install/uninstall/help/version"
```

---

### Task 5: Wire Up Entry Point

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Read current `src/index.ts`**

Current content:

```ts
#!/usr/bin/env node
import { startServer } from "./mcp/server.js";
import { resolve } from "path";

const rootDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

startServer(rootDir).catch((err: unknown) => {
  console.error("Failed to start unity-indexer:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Replace `src/index.ts` with CLI dispatch**

```ts
#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs, getHelpText } from "./cli/cli.js";
import { resolveSettingsPath, installServer, uninstallServer } from "./cli/settings.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const version = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;

const action = parseArgs(process.argv.slice(2));

switch (action.kind) {
  case "help": {
    console.log(getHelpText(version));
    process.exit(0);
    break;
  }
  case "version": {
    console.log(version);
    process.exit(0);
    break;
  }
  case "install": {
    const filePath = resolveSettingsPath(action.scope);
    installServer(filePath);
    console.log(`Installed unity-indexer in ${action.scope} settings: ${filePath}`);
    process.exit(0);
    break;
  }
  case "uninstall": {
    try {
      const filePath = resolveSettingsPath(action.scope);
      uninstallServer(filePath);
      console.log(`Removed unity-indexer from ${action.scope} settings: ${filePath}`);
    } catch (err) {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    }
    process.exit(0);
    break;
  }
  case "server": {
    const rootDir = action.projectRoot !== undefined ? resolve(action.projectRoot) : process.cwd();
    const { startServer } = await import("./mcp/server.js");
    startServer(rootDir).catch((err: unknown) => {
      console.error("Failed to start unity-indexer:", err);
      process.exit(1);
    });
    break;
  }
}
```

Note: `startServer` uses dynamic `import()` so the heavy MCP/sqlite/tree-sitter deps are only loaded when actually running the server, not for `install`/`--help`/`--version`.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`

Expected: No errors.

- [ ] **Step 5: Verify all tests still pass**

Run: `npm test`

Expected: All tests pass (existing + new CLI tests).

- [ ] **Step 6: Manual smoke test**

Run:

```bash
node dist/index.js --version
node dist/index.js --help
```

Expected: Version prints `0.1.0`. Help text prints usage info.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire CLI dispatch into entry point"
```

---

### Task 6: End-to-End Smoke Test

**Files:**

- No new files — manual verification

- [ ] **Step 1: Build**

Run: `npm run build`

- [ ] **Step 2: Test install to temp scope**

Test project-scoped install to avoid touching real settings:

```bash
cd /tmp && mkdir -p test-install-dir && cd test-install-dir
node /Users/bogdanman/Documents/unity-indexer/dist/index.js install --scope project
cat .claude/settings.json
```

Expected:

```json
{
  "mcpServers": {
    "unity-indexer": {
      "command": "npx",
      "args": ["-y", "unity-indexer"]
    }
  }
}
```

- [ ] **Step 3: Test uninstall**

```bash
node /Users/bogdanman/Documents/unity-indexer/dist/index.js uninstall --scope project
cat .claude/settings.json
```

Expected: `mcpServers` is empty object `{}`.

- [ ] **Step 4: Test error cases**

```bash
node /Users/bogdanman/Documents/unity-indexer/dist/index.js uninstall --scope project 2>&1
```

Expected: Error message — `unity-indexer is not registered`.

```bash
node /Users/bogdanman/Documents/unity-indexer/dist/index.js install --scope invalid 2>&1
```

Expected: Error message — `Invalid scope`.

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/test-install-dir
```

- [ ] **Step 6: Run full CI**

Run: `npm run ci`

Expected: typecheck, lint, format:check, test, build all pass.

- [ ] **Step 7: Commit (if any formatting fixes needed)**

```bash
git add -A
git commit -m "chore: formatting fixes from CI validation"
```

Only commit if there are staged changes. Skip if clean.
