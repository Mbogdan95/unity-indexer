# Auto-Discovery & DB Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-discover Unity projects within a given folder, support multiple projects, relocate DB to `.unity-indexer/` with `.gitignore`, and remove the MCP path requirement.

**Architecture:** A new discovery module walks the directory tree (max 3 levels) looking for directories with both `Assets/` and `ProjectSettings/`. The server creates one Store+Indexer+FileWatcher per discovered project. MCP resources and tools are namespaced by project name. A `StoreResolver` function replaces direct `Store` references in tool registration.

**Tech Stack:** Node.js, TypeScript, better-sqlite3, Vitest, @modelcontextprotocol/sdk

---

## File Map

| Action | File                                                  | Responsibility                                                             |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Create | `src/discovery.ts`                                    | `discoverUnityProjects()` + `isUnityProject()` + `ensureDbDir()`           |
| Create | `tests/discovery.test.ts`                             | Discovery unit tests                                                       |
| Modify | `src/mcp/server.ts`                                   | Multi-project orchestration, DB relocation, project-namespaced resources   |
| Modify | `src/mcp/tools.ts`                                    | `StoreResolver` pattern, optional `project` param on all tools             |
| Modify | `src/mcp/resources.ts`                                | Accept project name, no signature changes needed (just called differently) |
| Modify | `src/index.ts`                                        | Remove `dbPath` computation, pass rootDir only                             |
| Modify | `tests/mcp/tools.test.ts`                             | Update `registerTools` calls to use resolver                               |
| Modify | `tests/integration.test.ts`                           | Update for new `startServer` signature                                     |
| Create | `tests/fixtures/TestProject/ProjectSettings/.gitkeep` | Make fixture pass discovery                                                |

---

### Task 1: Discovery Module — Tests

**Files:**

- Create: `tests/discovery.test.ts`
- Create: `tests/fixtures/TestProject/ProjectSettings/.gitkeep`

- [ ] **Step 1: Add `ProjectSettings/` to test fixture**

Create the directory marker so the test fixture qualifies as a Unity project:

```bash
touch tests/fixtures/TestProject/ProjectSettings/.gitkeep
```

- [ ] **Step 2: Write discovery tests**

```typescript
// tests/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { discoverUnityProjects, isUnityProject } from "../src/discovery.js";

const TMP = join(import.meta.dirname, "tmp-discovery");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function makeUnityProject(path: string): void {
  mkdirSync(join(path, "Assets"), { recursive: true });
  mkdirSync(join(path, "ProjectSettings"), { recursive: true });
}

describe("isUnityProject", () => {
  it("returns true when Assets/ and ProjectSettings/ exist", () => {
    makeUnityProject(TMP);
    expect(isUnityProject(TMP)).toBe(true);
  });

  it("returns false when only Assets/ exists", () => {
    mkdirSync(join(TMP, "Assets"), { recursive: true });
    expect(isUnityProject(TMP)).toBe(false);
  });

  it("returns false for empty directory", () => {
    expect(isUnityProject(TMP)).toBe(false);
  });
});

describe("discoverUnityProjects", () => {
  it("finds project at root level", () => {
    makeUnityProject(TMP);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([TMP]);
  });

  it("finds project nested one level deep", () => {
    const nested = join(TMP, "MyGame");
    makeUnityProject(nested);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([nested]);
  });

  it("finds multiple projects", () => {
    const game1 = join(TMP, "GameA");
    const game2 = join(TMP, "GameB");
    makeUnityProject(game1);
    makeUnityProject(game2);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([game1, game2]);
  });

  it("does not search inside a discovered project", () => {
    const outer = join(TMP, "Outer");
    makeUnityProject(outer);
    const inner = join(outer, "Assets", "Nested");
    makeUnityProject(inner);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([outer]);
  });

  it("respects max depth", () => {
    const deep = join(TMP, "a", "b", "c", "d", "MyGame");
    makeUnityProject(deep);
    const shallow = discoverUnityProjects(TMP, 3);
    expect(shallow).toEqual([]);
    const deeper = discoverUnityProjects(TMP, 5);
    expect(deeper).toEqual([deep]);
  });

  it("skips ignored directories", () => {
    const nodeModules = join(TMP, "node_modules", "SomeProject");
    makeUnityProject(nodeModules);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([]);
  });

  it("returns empty array when no projects found", () => {
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([]);
  });

  it("returns sorted results", () => {
    const z = join(TMP, "ZProject");
    const a = join(TMP, "AProject");
    makeUnityProject(z);
    makeUnityProject(a);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([a, z]);
  });
});
```

- [ ] **Step 3: Run tests — expect failure (module doesn't exist)**

Run: `npx vitest run tests/discovery.test.ts`
Expected: FAIL — cannot resolve `../src/discovery.js`

- [ ] **Step 4: Commit test file and fixture**

```bash
git add tests/discovery.test.ts tests/fixtures/TestProject/ProjectSettings/.gitkeep
git commit -m "test: add discovery module tests and ProjectSettings fixture"
```

---

### Task 2: Discovery Module — Implementation

**Files:**

- Create: `src/discovery.ts`

- [ ] **Step 1: Implement discovery module**

```typescript
// src/discovery.ts
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Library",
  "Temp",
  "obj",
  "Logs",
  "Build",
  "Builds",
]);

export function isUnityProject(dir: string): boolean {
  return existsSync(join(dir, "Assets")) && existsSync(join(dir, "ProjectSettings"));
}

export function discoverUnityProjects(rootDir: string, maxDepth: number = 3): string[] {
  const root = resolve(rootDir);
  const results: string[] = [];
  walk(root, 0, maxDepth, results);
  results.sort();
  return results;
}

function walk(dir: string, depth: number, maxDepth: number, results: string[]): void {
  if (depth > maxDepth) return;

  if (isUnityProject(dir)) {
    results.push(dir);
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;

    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, depth + 1, maxDepth, results);
      }
    } catch {
      continue;
    }
  }
}
```

- [ ] **Step 2: Run tests — expect pass**

Run: `npx vitest run tests/discovery.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/discovery.ts
git commit -m "feat: add Unity project discovery module"
```

---

### Task 3: DB Directory Setup

**Files:**

- Modify: `src/discovery.ts` (add `ensureDbDir`)

- [ ] **Step 1: Add test for `ensureDbDir`**

Append to `tests/discovery.test.ts`:

```typescript
import { ensureDbDir } from "../src/discovery.js";
import { existsSync, readFileSync } from "fs";

describe("ensureDbDir", () => {
  it("creates .unity-indexer dir with .gitignore and returns db path", () => {
    makeUnityProject(TMP);
    const dbPath = ensureDbDir(TMP);
    expect(dbPath).toBe(join(TMP, ".unity-indexer", "index.db"));
    expect(existsSync(join(TMP, ".unity-indexer"))).toBe(true);
    const gitignore = readFileSync(join(TMP, ".unity-indexer", ".gitignore"), "utf8");
    expect(gitignore).toBe("*\n");
  });

  it("is idempotent", () => {
    makeUnityProject(TMP);
    ensureDbDir(TMP);
    const dbPath = ensureDbDir(TMP);
    expect(dbPath).toBe(join(TMP, ".unity-indexer", "index.db"));
  });
});
```

Update the import at the top of the file to include `ensureDbDir`:

```typescript
import { discoverUnityProjects, isUnityProject, ensureDbDir } from "../src/discovery.js";
```

Update the `fs` import to include `readFileSync`:

```typescript
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
```

- [ ] **Step 2: Run test — expect fail**

Run: `npx vitest run tests/discovery.test.ts`
Expected: FAIL — `ensureDbDir` is not exported

- [ ] **Step 3: Implement `ensureDbDir`**

Add to `src/discovery.ts`:

```typescript
import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "fs";

export function ensureDbDir(projectRoot: string): string {
  const dir = join(projectRoot, ".unity-indexer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "*\n");
  return join(dir, "index.db");
}
```

(Update the `fs` import at the top of `src/discovery.ts` to include `mkdirSync` and `writeFileSync`.)

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run tests/discovery.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery.ts tests/discovery.test.ts
git commit -m "feat: add ensureDbDir for .unity-indexer/ directory setup"
```

---

### Task 4: StoreResolver in Tools

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

This task adds the `project` parameter to all tools and changes `registerTools` to accept a `StoreResolver` instead of a direct `Store`.

- [ ] **Step 1: Define `StoreResolver` type and update `registerTools` signature**

In `src/mcp/tools.ts`, change the registration function. The handler functions themselves stay unchanged — they still accept `Store` directly. Only the wiring in `registerTools` changes.

Replace the `registerTools` function signature and add the resolver type at the top of the file (after existing imports):

```typescript
export type StoreResolver = (projectName?: string) => Store;
```

Replace the `registerTools` function definition (line 452):

```typescript
export function registerTools(server: McpServer, resolveStore: StoreResolver): void {
```

Add `project` to every tool's `inputSchema`. For each `server.registerTool(...)` call, add:

```typescript
project: z.string().optional().describe("Project name (required if multiple projects indexed)"),
```

And update each handler callback to resolve the store from params. For example, the first tool becomes:

```typescript
server.registerTool(
  "get_scene_hierarchy",
  {
    description: "Get the GameObject hierarchy for a scene or prefab file.",
    inputSchema: {
      project: z
        .string()
        .optional()
        .describe("Project name (required if multiple projects indexed)"),
      scene: z.string().describe("Relative path to the scene or prefab file"),
      depth: z.number().int().optional().describe("Max depth to include (0 = roots only)"),
      filter: z.string().optional().describe("Filter by name or tag substring"),
    },
  },
  (params) => toContent(handleGetSceneHierarchy(resolveStore(params.project), params)),
);
```

Apply the same pattern to **every** tool registration: add `project` to `inputSchema`, change `store` to `resolveStore(params.project)` in the handler callback. The full list of tools to update:

1. `get_scene_hierarchy` — `handleGetSceneHierarchy(resolveStore(params.project), params)`
2. `get_prefab_structure` — `handleGetPrefabStructure(resolveStore(params.project), params)`
3. `list_scripts` — `handleListScripts(resolveStore(params.project), params)`
4. `list_assets` — `handleListAssets(resolveStore(params.project), params)`
5. `get_game_object` — `handleGetGameObject(resolveStore(params.project), params)`
6. `get_component` — `handleGetComponent(resolveStore(params.project), params)`
7. `get_script_detail` — `handleGetScriptDetail(resolveStore(params.project), params)`
8. `get_script_member` — `handleGetScriptMember(resolveStore(params.project), params)`
9. `find_references` — `handleFindReferences(resolveStore(params.project), params)`
10. `find_dependencies` — `handleFindDependencies(resolveStore(params.project), params)`
11. `resolve_guid` — `handleResolveGuid(resolveStore(params.project), params)`
12. `search` — `handleSearch(resolveStore(params.project), params)`
13. `find_components` — `handleFindComponents(resolveStore(params.project), params)`
14. `recent_changes` — `handleRecentChanges(resolveStore(params.project), params)`

- [ ] **Step 2: Update tools test file**

In `tests/mcp/tools.test.ts`, the handler functions are called directly with `store` — those don't change. But if the test calls `registerTools`, update it. Check the test file: the existing tests call handler functions directly (e.g., `handleGetSceneHierarchy(store, {...})`), so no changes needed to handler tests.

However, add a test for the resolver pattern:

```typescript
import { registerTools, type StoreResolver } from "../../src/mcp/tools.js";

describe("registerTools with StoreResolver", () => {
  it("accepts a StoreResolver function", () => {
    const resolver: StoreResolver = () => store;
    // Just verify it doesn't throw — registration is the test
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerTools(server, resolver)).not.toThrow();
  });
});
```

Note: This test verifies the wiring compiles and doesn't throw. The handler-level tests already cover correctness.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add StoreResolver pattern and project param to all MCP tools"
```

---

### Task 5: Multi-Project Server Orchestration

**Files:**

- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Rewrite `startServer`**

Replace the entire contents of `src/mcp/server.ts`:

```typescript
import { existsSync, unlinkSync } from "fs";
import { basename } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "../db/store.js";
import { Indexer } from "../indexer/indexer.js";
import { FileWatcher } from "../indexer/file-watcher.js";
import { initScriptParser } from "../parsers/script-parser.js";
import { getProjectSummary, getProjectFiles } from "./resources.js";
import { registerTools, type StoreResolver } from "./tools.js";
import { discoverUnityProjects, ensureDbDir } from "../discovery.js";

interface ProjectInstance {
  name: string;
  projectRoot: string;
  store: Store;
  indexer: Indexer;
  watcher: FileWatcher;
}

function removeStaleJournals(dbPath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // best-effort
      }
    }
  }
}

function log(msg: string): void {
  console.error(`[unity-indexer] ${msg}`);
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${String(i)}`)) i++;
  return `${base}-${String(i)}`;
}

export async function startServer(rootDir: string): Promise<void> {
  const projectPaths = discoverUnityProjects(rootDir);

  if (projectPaths.length === 0) {
    log(`no Unity projects found under ${rootDir}`);
    process.exit(1);
  }

  log(`found ${String(projectPaths.length)} Unity project(s)`);

  log("initializing C# parser...");
  await initScriptParser();

  const projects = new Map<string, ProjectInstance>();
  const usedNames = new Set<string>();

  for (const projectRoot of projectPaths) {
    const name = uniqueName(basename(projectRoot), usedNames);
    usedNames.add(name);

    const dbPath = ensureDbDir(projectRoot);
    removeStaleJournals(dbPath);
    log(`[${name}] project: ${projectRoot}`);
    log(`[${name}] database: ${dbPath}`);

    let store: Store;
    let indexer: Indexer;
    let watcher: FileWatcher;

    try {
      store = new Store(dbPath);
      indexer = new Indexer(store, projectRoot);

      log(`[${name}] indexing...`);
      const start = Date.now();
      indexer.indexAll();
      const summary = store.getProjectSummary();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log(
        `[${name}] indexed in ${elapsed}s — ${String(summary.scene_count)} scenes, ${String(summary.prefab_count)} prefabs, ${String(summary.script_count)} scripts`,
      );

      watcher = new FileWatcher(indexer, projectRoot);
      watcher.start();
      log(`[${name}] file watcher started`);
    } catch (err) {
      log(`[${name}] failed to initialize: ${String(err)}`);
      continue;
    }

    projects.set(name, { name, projectRoot, store, indexer, watcher });
  }

  if (projects.size === 0) {
    log("all projects failed to initialize");
    process.exit(1);
  }

  const resolveStore: StoreResolver = (projectName?: string) => {
    if (projectName) {
      const p = projects.get(projectName);
      if (!p) {
        throw new Error(
          `Unknown project "${projectName}". Available: ${[...projects.keys()].join(", ")}`,
        );
      }
      return p.store;
    }
    if (projects.size === 1) {
      return projects.values().next().value!.store;
    }
    throw new Error(
      `Multiple projects indexed. Specify "project" parameter. Available: ${[...projects.keys()].join(", ")}`,
    );
  };

  const server = new McpServer({
    name: "unity-indexer",
    version: "0.1.0",
  });

  // Register per-project resources
  for (const [name, project] of projects) {
    server.registerResource(
      `${name}-summary`,
      `unity://${name}/summary`,
      { description: `Project overview for ${name}. ~200 tokens.` },
      () => ({
        contents: [
          {
            uri: `unity://${name}/summary`,
            mimeType: "application/json",
            text: JSON.stringify(getProjectSummary(project.store), null, 2),
          },
        ],
      }),
    );

    server.registerResource(
      `${name}-files`,
      `unity://${name}/files`,
      { description: `All files in ${name} sorted by importance. Paginated.` },
      () => ({
        contents: [
          {
            uri: `unity://${name}/files`,
            mimeType: "application/json",
            text: JSON.stringify(getProjectFiles(project.store), null, 2),
          },
        ],
      }),
    );
  }

  // Top-level discovery resource
  server.registerResource(
    "projects",
    "unity://projects",
    { description: "List all indexed Unity projects." },
    () => ({
      contents: [
        {
          uri: "unity://projects",
          mimeType: "application/json",
          text: JSON.stringify(
            [...projects.values()].map((p) => ({
              name: p.name,
              path: p.projectRoot,
              summary: p.store.getProjectSummary().description,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  registerTools(server, resolveStore);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server ready");

  const cleanup = () => {
    for (const project of projects.values()) {
      project.watcher.stop();
      try {
        project.store.close();
      } catch {
        // best-effort
      }
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("beforeExit", cleanup);
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanup();
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: multi-project server with per-project resources and discovery"
```

---

### Task 6: CLI Entry Point Update

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Simplify `index.ts`**

Replace `src/index.ts`:

```typescript
#!/usr/bin/env node
import { startServer } from "./mcp/server.js";
import { resolve } from "path";

const rootDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

startServer(rootDir).catch((err: unknown) => {
  console.error("Failed to start unity-indexer:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI uses discovery, no longer requires exact project path"
```

---

### Task 7: Fix Existing Tests

**Files:**

- Modify: `tests/integration.test.ts`
- Verify: `tests/mcp/tools.test.ts`
- Verify: `tests/indexer/indexer.test.ts`

The existing tests call handler functions directly with a `Store` — those don't need changes. But `integration.test.ts` imports from `resources.ts` which hasn't changed. The main thing is ensuring the test fixture has `ProjectSettings/` so discovery works if any test uses it.

- [ ] **Step 1: Verify all existing tests pass**

Run: `npx vitest run`
Expected: all tests PASS. The existing tests create stores directly with `:memory:` and call handlers — they don't go through `startServer`, so they should be unaffected.

- [ ] **Step 2: If any test fails, fix it**

Likely fixes:

- If `registerTools` is called in any test with `(server, store)`, update to `(server, () => store)`.
- If any test imports changed signatures, update the imports.

- [ ] **Step 3: Run full test suite including typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass

- [ ] **Step 4: Commit if changes were needed**

```bash
git add -A tests/
git commit -m "test: update tests for new registerTools signature"
```

---

### Task 8: Discovery Integration Test

**Files:**

- Modify: `tests/integration.test.ts`

- [ ] **Step 1: Add discovery integration test**

Add a new `describe` block to `tests/integration.test.ts`:

```typescript
import { discoverUnityProjects, isUnityProject } from "../src/discovery.js";

describe("Integration: discovery", () => {
  it("discovers the test fixture as a Unity project", () => {
    expect(isUnityProject(FIXTURES)).toBe(true);
  });

  it("finds TestProject from parent directory", () => {
    const fixturesParent = join(import.meta.dirname, "fixtures");
    const results = discoverUnityProjects(fixturesParent);
    expect(results).toContain(FIXTURES);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add discovery integration tests"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Full CI check**

Run: `npm run ci`
Expected: typecheck + lint + format + tests + build all pass

- [ ] **Step 2: Manual smoke test with real Unity project (if available)**

Run: `npx tsx src/index.ts /path/to/folder/containing/unity/project`
Expected: logs show discovery, indexing, and "MCP server ready"

- [ ] **Step 3: Verify `.unity-indexer/` directory was created with `.gitignore`**

```bash
ls -la /path/to/unity/project/.unity-indexer/
cat /path/to/unity/project/.unity-indexer/.gitignore
```

Expected: directory contains `index.db` and `.gitignore` with contents `*`
