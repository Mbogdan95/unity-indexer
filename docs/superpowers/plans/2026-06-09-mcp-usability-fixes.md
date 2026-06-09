# MCP Usability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five usability gaps found in the 3-way benchmark: node-ID lookup in get_script_detail, missing file_path on graph traversal nodes, method body extraction, and a batch lookup tool.

**Architecture:** Five independent tasks. Tasks 1–2 touch only MCP handlers. Task 3 is a schema change (script_members line numbers + project_summary root_path) that Tasks 4–5 depend on. Re-indexing required after Task 3.

**Tech Stack:** TypeScript, better-sqlite3, tree-sitter-c_sharp, Vitest, Node.js fs

---

## File Map

| File                            | Change                                          |
| ------------------------------- | ----------------------------------------------- |
| `src/mcp/tools.ts`              | Tasks 1, 4, 5                                   |
| `src/mcp/graph-tools.ts`        | Task 2                                          |
| `src/db/schema.ts`              | Task 3: add columns                             |
| `src/types.ts`                  | Task 3: update interfaces                       |
| `src/parsers/script-parser.ts`  | Task 3: capture line numbers                    |
| `src/db/store.ts`               | Task 3: insertScriptMember + getProjectRootPath |
| `src/indexer/indexer.ts`        | Task 3: store root_path on index                |
| `tests/mcp/tools.test.ts`       | Tasks 1, 4, 5                                   |
| `tests/mcp/graph-tools.test.ts` | Task 2                                          |
| `tests/indexer/indexer.test.ts` | Task 3                                          |

---

## Task 1: `get_script_detail` accepts `script:N` node IDs

**Files:** `src/mcp/tools.ts`, `tests/mcp/tools.test.ts`

Agents receiving graph traversal output use the raw `id` field (`script:4625`) instead of the `label` field when calling `get_script_detail`. Fix by accepting both formats.

- [ ] **Step 1: Write the failing test**

In `tests/mcp/tools.test.ts`, add inside the `handleGetScriptDetail` describe block:

```typescript
it("accepts script:N node ID format", () => {
  // First get the real ID of PlayerController
  const pc = store.getScriptByClassName("PlayerController");
  expect(pc).toBeDefined();
  const nodeId = `script:${pc!.id}`;

  const result = handleGetScriptDetail(store, { class_name: nodeId }) as Record<string, unknown>;
  expect(result.error).toBeUndefined();
  expect(result.class_name).toBe("PlayerController");
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL — `result.error` is defined ("Script not found: script:N").

- [ ] **Step 3: Update `handleGetScriptDetail` in `src/mcp/tools.ts`**

The function currently starts with:

```typescript
const script = store.getScriptByClassName(params.class_name);
```

Replace those first two lines with:

```typescript
let script: (ScriptRow & { id: number }) | undefined;
if (params.class_name.startsWith("script:")) {
  const { type, id } = decodeNodeId(params.class_name);
  if (type === "script") script = store.getScriptById(id);
} else {
  script = store.getScriptByClassName(params.class_name);
}
```

Also update the tool description in `registerTools()` to mention: `"Accepts both class name ('PlayerController') and node ID ('script:42') formats."`

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: 254+ passed.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: get_script_detail accepts script:N node ID format"
```

---

## Task 2: `file_path` on graph traversal script nodes

**Files:** `src/mcp/graph-tools.ts`, `tests/mcp/graph-tools.test.ts`

Graph traversal nodes currently return `{id, type, depth, label}`. Add `file_path` for script-type nodes so agents can immediately read the file without an extra lookup.

- [ ] **Step 1: Write the failing test**

In `tests/mcp/graph-tools.test.ts`, update the `handleTraceDependencies` test to also assert `file_path`:

```typescript
it("returns subgraph for known script", () => {
  const result = handleTraceDependencies(store, {
    identifier: "PlayerController",
    depth: 2,
  }) as Record<string, unknown>;

  expect(result.nodes).toBeDefined();
  expect(result.edges).toBeDefined();
  expect(result.summary).toBeDefined();
  const nodes = result.nodes as Array<Record<string, unknown>>;
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
  // NEW: script-type nodes have file_path
  const scriptNodes = nodes.filter((n) => n.type === "script");
  expect(scriptNodes.length).toBeGreaterThan(0);
  expect(
    scriptNodes.every(
      (n) => typeof n.file_path === "string" && (n.file_path as string).endsWith(".cs"),
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/mcp/graph-tools.test.ts
```

Expected: FAIL — `file_path` not present.

- [ ] **Step 3: Replace `resolveNodeLabel` with `resolveNodeInfo` in `src/mcp/graph-tools.ts`**

Replace the entire `resolveNodeLabel` function with `resolveNodeInfo`:

```typescript
function resolveNodeInfo(store: Store, nodeId: string): { label: string; file_path?: string } {
  const { type, id } = decodeNodeId(nodeId);
  switch (type) {
    case "script": {
      const script = store.getScriptById(id);
      if (!script) return { label: nodeId };
      const file = store.getFileById(script.file_id);
      return { label: script.class_name, file_path: file?.path };
    }
    case "file": {
      const file = store.getFileById(id);
      return { label: file?.path ?? nodeId };
    }
    case "game_object": {
      const go = store.getGameObjectById(id);
      return { label: go?.name ?? nodeId };
    }
    case "assembly": {
      const asm = store.getAssemblyById(id);
      return { label: asm?.name ?? nodeId };
    }
    default:
      return { label: nodeId };
  }
}
```

- [ ] **Step 4: Update all four handlers to use `resolveNodeInfo`**

For `handleTraceDependencies`, `handleTraceDependents`, `handleGetSubgraph` — replace the node mapping:

```typescript
nodes: result.nodes.map((n) => {
  const { type } = decodeNodeId(n.id);
  const info = resolveNodeInfo(store, n.id);
  return {
    id: n.id,
    type,
    depth: n.depth,
    label: info.label,
    ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
  };
}),
```

For `handleFindPath` — replace the path node mapping:

```typescript
path: result.nodes.map((nodeId) => {
  const { type } = decodeNodeId(nodeId);
  const info = resolveNodeInfo(store, nodeId);
  return {
    id: nodeId,
    type,
    label: info.label,
    ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
  };
}),
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/mcp/graph-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/graph-tools.ts tests/mcp/graph-tools.test.ts
git commit -m "feat: add file_path to script nodes in graph traversal results"
```

---

## Task 3: Schema — `start_line`/`end_line` on `script_members` + `root_path` on `project_summary`

**Files:** `src/db/schema.ts`, `src/types.ts`, `src/parsers/script-parser.ts`, `src/db/store.ts`, `src/indexer/indexer.ts`, `tests/indexer/indexer.test.ts`

Prerequisite for Task 4. Adds line number tracking for method body extraction, and stores the project root path so MCP tools can read source files at query time.

- [ ] **Step 1: Write the failing tests**

In `tests/indexer/indexer.test.ts`, add:

```typescript
it("indexes script members with start_line and end_line", () => {
  indexer.indexAll();
  const pc = store.getScriptByClassName("PlayerController");
  expect(pc).toBeDefined();
  const members = store.getScriptMembers(pc!.id);
  expect(members.length).toBeGreaterThan(0);
  // Every member should have line numbers > 0
  expect(members.every((m) => m.start_line > 0 && m.end_line > 0)).toBe(true);
  // start_line <= end_line
  expect(members.every((m) => m.start_line <= m.end_line)).toBe(true);
});

it("stores project root path in project_summary", () => {
  indexer.indexAll();
  const rootPath = store.getProjectRootPath();
  expect(rootPath.length).toBeGreaterThan(0);
  // Should be an absolute path to the fixture directory
  expect(rootPath).toContain("TestProject");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/indexer/indexer.test.ts
```

Expected: FAIL — `m.start_line` is undefined, `getProjectRootPath` is not a function.

- [ ] **Step 3: Update `src/db/schema.ts`**

Add `start_line` and `end_line` to `script_members` table (add after `has_serialize_field`):

```sql
start_line  INTEGER NOT NULL DEFAULT 0,
end_line    INTEGER NOT NULL DEFAULT 0,
```

Add `root_path` to `project_summary` table (add after `indexed_at`):

```sql
root_path   TEXT NOT NULL DEFAULT ''
```

- [ ] **Step 4: Update `src/types.ts`**

In `ParsedScriptMember` interface, add:

```typescript
startLine: number; // 1-indexed source line, 0 if unknown
endLine: number; // 1-indexed source line, 0 if unknown
```

In `ScriptMemberRow` interface, add:

```typescript
start_line: number;
end_line: number;
```

In `ProjectSummaryRow` interface, add:

```typescript
root_path: string;
```

- [ ] **Step 5: Update `src/parsers/script-parser.ts`**

In `parseMethod`, add to the return object:

```typescript
startLine: node.startPosition.row + 1,
endLine: node.endPosition.row + 1,
```

In `parseField`, add to each declarator's return object:

```typescript
startLine: node.startPosition.row + 1,
endLine: node.endPosition.row + 1,
```

(uses the parent `field_declaration` node, not the declarator)

In `parseProperty`, add to the return object:

```typescript
startLine: node.startPosition.row + 1,
endLine: node.endPosition.row + 1,
```

In `parseConstructor`, add to the return object:

```typescript
startLine: node.startPosition.row + 1,
endLine: node.endPosition.row + 1,
```

In `parseEventField`, add to each declarator's return object:

```typescript
startLine: node.startPosition.row + 1,
endLine: node.endPosition.row + 1,
```

(uses the parent `event_field_declaration` node, not the declarator)

- [ ] **Step 6: Update `src/db/store.ts`**

Find `insertScriptMember` (the method that inserts into `script_members`). Add `start_line` and `end_line` to the INSERT statement and the parameter object:

```typescript
// In the INSERT SQL, add:
start_line, end_line

// In the values object, add:
start_line: member.startLine ?? 0,
end_line: member.endLine ?? 0,
```

Also check `scriptMemberRowOut` helper (if it exists) — add the new columns to its output mapping.

Add `getProjectRootPath()` method near `updateProjectSummary`:

```typescript
getProjectRootPath(): string {
  const row = this.prepare(
    "SELECT root_path FROM project_summary WHERE id = 1",
  ).get() as { root_path: string } | undefined;
  return row?.root_path ?? "";
}
```

- [ ] **Step 7: Update `src/indexer/indexer.ts`**

In `updateProjectSummary()`, add `root_path: this.projectRoot` to the `updateProjectSummary` call:

```typescript
this.store.updateProjectSummary({
  file_counts: JSON.stringify(fileCounts),
  scene_count: sceneCount,
  prefab_count: prefabCount,
  script_count: scriptCount,
  assembly_structure: JSON.stringify(assemblyStructure),
  hot_scripts: JSON.stringify(hotScripts),
  description,
  indexed_at: new Date().toISOString(),
  root_path: this.projectRoot, // ADD THIS LINE
});
```

Check how `this.projectRoot` is stored on the Indexer class. It's likely set in the constructor as the second argument. Use whatever the field name is.

- [ ] **Step 8: Run tests**

```bash
npm test -- tests/indexer/indexer.test.ts
```

Expected: new tests PASS. All existing tests still PASS.

- [ ] **Step 9: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/types.ts src/parsers/script-parser.ts src/db/store.ts src/indexer/indexer.ts tests/indexer/indexer.test.ts
git commit -m "feat: add start_line/end_line to script_members and root_path to project_summary"
```

---

## Task 4: `include_bodies` parameter on `get_script_detail`

**Files:** `src/mcp/tools.ts`, `tests/mcp/tools.test.ts`

**Depends on Task 3.**

- [ ] **Step 1: Write the failing test**

In `tests/mcp/tools.test.ts`, add inside the `handleGetScriptDetail` describe block:

```typescript
it("returns method body when include_bodies is true", () => {
  const result = handleGetScriptDetail(store, {
    class_name: "PlayerController",
    include_bodies: true,
  }) as Record<string, unknown>;

  expect(result.error).toBeUndefined();
  const members = result.members as Array<Record<string, unknown>>;
  expect(members.length).toBeGreaterThan(0);

  // At least some members should have a body string
  const membersWithBody = members.filter(
    (m) => typeof m.body === "string" && (m.body as string).length > 0,
  );
  expect(membersWithBody.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL — no `body` field on members.

- [ ] **Step 3: Update `handleGetScriptDetail` in `src/mcp/tools.ts`**

Add `include_bodies?: boolean` to the params type:

```typescript
export function handleGetScriptDetail(
  store: Store,
  params: { class_name: string; include_bodies?: boolean },
): object {
```

After the `file` lookup, add body-loading logic:

```typescript
import { readFileSync } from "fs";
import { join } from "path";

// After: const file = store.getFileById(script.file_id);
let fileLines: string[] | null = null;
if (params.include_bodies) {
  const rootPath = store.getProjectRootPath();
  if (rootPath && file?.path) {
    try {
      fileLines = readFileSync(join(rootPath, file.path), "utf-8").split("\n");
    } catch {
      // file unreadable — skip bodies silently
    }
  }
}
```

Update the members mapping to include `body` when available:

```typescript
members: members.map((m) => {
  const attrs = JSON.parse(m.attributes) as string[];
  const base = {
    name: m.name,
    kind: m.kind,
    ...(m.access !== "public" ? { access: m.access } : {}),
    signature: m.signature,
    ...(attrs.length > 0 ? { attributes: attrs } : {}),
    ...(m.has_serialize_field ? { has_serialize_field: true } : {}),
  };
  if (fileLines && m.start_line > 0 && m.end_line > 0) {
    const body = fileLines.slice(m.start_line - 1, m.end_line).join("\n");
    return { ...base, body };
  }
  return base;
}),
```

Also update the MCP tool's `inputSchema` in `registerTools()` to add:

```typescript
include_bodies: z.boolean().optional().describe(
  "If true, include full source body for each member. Requires re-indexing if line numbers are missing."
),
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add include_bodies option to get_script_detail"
```

---

## Task 5: `batch_get_script_detail` MCP tool

**Files:** `src/mcp/tools.ts`, `tests/mcp/tools.test.ts`

Reduces sequential tool call overhead when an agent needs details for multiple classes. Accepts both class names and `script:N` formats (reuses Task 1 logic). Optional `include_bodies`.

- [ ] **Step 1: Write the failing test**

In `tests/mcp/tools.test.ts`, append a new describe block:

```typescript
// Add to imports:
import { handleBatchGetScriptDetail } from "../../src/mcp/tools.js";

describe("handleBatchGetScriptDetail", () => {
  it("returns details for multiple class names", () => {
    const result = handleBatchGetScriptDetail(store, {
      class_names: ["PlayerController", "HealthSystem"],
    }) as Record<string, unknown>;

    expect(result.results).toBeDefined();
    const results = result.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);

    const pc = results.find((r) => r.class_name === "PlayerController");
    expect(pc).toBeDefined();
    expect((pc!.detail as Record<string, unknown>).error).toBeUndefined();
    expect((pc!.detail as Record<string, unknown>).members).toBeDefined();
  });

  it("accepts script:N node IDs in batch", () => {
    const pc = store.getScriptByClassName("PlayerController");
    expect(pc).toBeDefined();
    const nodeId = `script:${pc!.id}`;

    const result = handleBatchGetScriptDetail(store, {
      class_names: [nodeId],
    }) as Record<string, unknown>;

    const results = result.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect((results[0].detail as Record<string, unknown>).class_name).toBe("PlayerController");
  });

  it("returns error entry for unknown class in batch", () => {
    const result = handleBatchGetScriptDetail(store, {
      class_names: ["PlayerController", "INonExistent"],
    }) as Record<string, unknown>;

    const results = result.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    const unknown = results.find((r) => r.class_name === "INonExistent");
    expect(unknown).toBeDefined();
    expect((unknown!.detail as Record<string, unknown>).error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL — `handleBatchGetScriptDetail is not a function`.

- [ ] **Step 3: Implement `handleBatchGetScriptDetail` in `src/mcp/tools.ts`**

Add before `registerTools`:

```typescript
export function handleBatchGetScriptDetail(
  store: Store,
  params: { class_names: string[]; include_bodies?: boolean },
): object {
  const results = params.class_names.map((name) => ({
    class_name: name,
    detail: handleGetScriptDetail(store, {
      class_name: name,
      include_bodies: params.include_bodies,
    }),
  }));
  return { token_hint: estimateTokens(results), results };
}
```

Register in `registerTools()`:

```typescript
server.registerTool(
  "batch_get_script_detail",
  {
    description:
      "Get full details for multiple scripts in one call. Accepts class names or script:N node IDs. " +
      "Reduces tool-call overhead when analysing related classes.",
    inputSchema: {
      class_names: z
        .array(z.string())
        .describe(
          "Array of class names or script:N node IDs (e.g. ['PlayerController', 'HealthSystem'])",
        ),
      include_bodies: z
        .boolean()
        .optional()
        .describe("If true, include full source body for each member"),
      project: z
        .string()
        .optional()
        .describe("Project name (required if multiple projects indexed)"),
    },
  },
  (params) => toContent(handleBatchGetScriptDetail(resolveStore(params.project), params)),
);
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add batch_get_script_detail MCP tool"
```

---

## Spec Coverage

| Benchmark gap                                                      | Task      |
| ------------------------------------------------------------------ | --------- |
| `get_script_detail` rejects `script:N` format → "Script not found" | Task 1    |
| Graph traversal nodes missing `file_path`                          | Task 2    |
| Method body detail requires separate file read                     | Tasks 3+4 |
| Sequential tool overhead for multi-class lookup                    | Task 5    |

> **Re-indexing note:** After Task 3, existing databases must be re-indexed (`unity-indexer index <path>`) to populate `start_line`/`end_line` and `root_path`. `include_bodies` silently returns no body fields on old databases (safe fallback via `m.start_line > 0` guard).
