# Installation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SessionStart hook injection, Cursor plugin support, and a rewritten comprehensive SKILL.md — mirroring the obra/Superpowers plugin pattern.

**Architecture:** A bash hook script fires on every session start, reads `skills/unity-indexer/SKILL.md`, and emits harness-specific JSON that Claude Code or Cursor inject as `<EXTREMELY_IMPORTANT>` context. Plugin manifests in `.claude-plugin/` (updated) and `.cursor-plugin/` (new) declare the hooks and MCP server so both harnesses auto-register everything on install.

**Tech Stack:** Bash (hooks/session-start), JSON (manifests), Markdown (SKILL.md), TypeScript/Vitest (hook tests)

**Spec:** `docs/specs/2026-06-24-installation-redesign.md`

---

## File Map

| Action  | Path                            | Responsibility                                               |
| ------- | ------------------------------- | ------------------------------------------------------------ |
| Rewrite | `skills/unity-indexer/SKILL.md` | Comprehensive auto-injected guide (tools + workflows + tips) |
| Create  | `hooks/session-start`           | Bash script: detect harness, read SKILL.md, emit JSON        |
| Create  | `hooks/hooks.json`              | Claude Code SessionStart hook registration                   |
| Create  | `hooks/hooks-cursor.json`       | Cursor sessionStart hook registration                        |
| Modify  | `.claude-plugin/plugin.json`    | Add `hooks` field                                            |
| Create  | `.cursor-plugin/plugin.json`    | Skills + hooks + mcpServers for Cursor                       |
| Create  | `mcp.json`                      | Cursor MCP server declaration                                |
| Modify  | `package.json`                  | Add skills/, hooks/, mcp.json to `files`                     |
| Create  | `tests/hooks/hook.test.ts`      | Vitest tests for session-start script                        |

---

## Task 1: Rewrite skills/unity-indexer/SKILL.md

**Files:**

- Modify: `skills/unity-indexer/SKILL.md`

- [ ] **Step 1: Replace SKILL.md with the comprehensive guide**

Replace the entire file content with:

````markdown
# unity-indexer MCP Tools

Use these MCP tools when working with Unity projects. They are faster and more token-efficient than reading `.unity`, `.prefab`, `.asset`, or `.meta` files directly — those are YAML blobs with GUIDs that require extensive parsing.

## Server startup

If tools return "no store" or are unavailable, start the server:

```bash
npx unity-indexer <path-to-unity-project>
```
````

For auto-discovery (scans 3 levels deep for Unity projects):

```bash
npx unity-indexer
```

## Tools (23)

### Scene & Prefab

| Tool                   | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | Full GameObject tree for a scene or prefab. Start here when orienting in an unfamiliar scene. |
| `get_prefab_structure` | GameObject hierarchy for a prefab file.                                                       |
| `get_game_object`      | Full details (components, children) for a specific GameObject.                                |
| `get_component`        | A specific component on a named GameObject.                                                   |

### Scripts (C#)

| Tool                      | Purpose                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_scripts`            | List C# classes, filterable by namespace, base class, assembly, or MonoBehaviour. Start here when exploring an unfamiliar system.                                        |
| `get_script_detail`       | Members (fields, methods, properties) with signatures and line numbers, plus callers/callees/implementors. Returns `file_path` — use with `Read` to fetch method bodies. |
| `batch_get_script_detail` | Same as `get_script_detail` for multiple classes in one call.                                                                                                            |
| `get_script_member`       | Details for a single member of a class.                                                                                                                                  |

### References & Dependencies

| Tool                | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `find_references`   | Everything that references a GUID or class name — scene/prefab usage and code callers. |
| `find_dependencies` | Outgoing references from a file, class, or GUID.                                       |
| `resolve_guid`      | Resolve a Unity GUID to a file path and asset type.                                    |

### Graph

| Tool                 | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `trace_dependencies` | Transitive dependency chain from a class.              |
| `trace_dependents`   | Everything that depends on a class (impact analysis).  |
| `find_path`          | Shortest relationship path between two nodes.          |
| `get_subgraph`       | Local neighborhood of a node.                          |
| `detect_cycles`      | Find circular dependencies in a namespace or assembly. |
| `get_graph_stats`    | Graph metrics (node counts, edge counts, density).     |
| `find_implementors`  | All classes implementing a given interface.            |

### Search & Assets

| Tool              | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                          |
| `find_components` | All GameObjects that have a specific component type attached.           |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.                 |
| `recent_changes`  | Files changed recently (pass ISO 8601 timestamp to filter).             |
| `find_unused`     | Find scripts, assets, or scenes not referenced anywhere in the project. |

## Workflows

### Orient in a scene

1. `get_scene_hierarchy(scene: "Assets/Scenes/Main.unity")` — full GameObject tree
2. `get_game_object(scene, name_or_id)` — components on any interesting object
3. `get_script_detail(class_name)` — members and callers for unknown components

### Find all uses of a component

1. `find_components(type: "PlayerController")` — all GameObjects with this component
2. `find_references(guid_or_name: "PlayerController")` — code callers + scene/prefab usage
3. `get_script_detail(class_name: "PlayerController")` — members, file_path + lines

### Trace an event chain

1. `get_script_detail(class_name: "EventBus")` — find the event field
2. `find_references(guid_or_name: "EventBus")` — everything referencing it
3. `get_subgraph(node: "EventBus", depth: 2)` — visual neighborhood for complex chains

### Understand dependencies before editing

1. `get_script_detail(class_name: "HealthSystem")` — current members and relationships
2. `trace_dependents(class_name: "HealthSystem")` — everything depending on it
3. `detect_cycles(class_name: "HealthSystem")` — circular deps that could tangle a refactor
4. `batch_get_script_detail(class_names: ["HealthSystem", "PlayerController", "GameManager"])` — review related classes in one call

### Explore a prefab

1. `get_prefab_structure(prefab: "Assets/Prefabs/Enemy.prefab")` — full hierarchy
2. `get_script_detail(class_name)` — for each component found
3. `find_references(guid_or_name: "Enemy")` — scenes and scripts using this prefab

### Narrow down a regression

1. `recent_changes(since: "2026-06-01T00:00:00Z")` — files changed since known-good date
2. `get_script_detail` on changed scripts — members and callers
3. `find_references` on changed classes — downstream breakage

## Tips

- Multiple Unity projects indexed? Pass `project: "<name>"` to scope any tool call.
- `get_script_detail` returns `file_path`, `start_line`, `end_line` per member — use `Read` with offset/limit to fetch method bodies without reading the whole file.
- `batch_get_script_detail` saves round-trips when you already know the class names.
- `search(query: "Player", scope: "scripts")` finds a class by partial name fastest.

````

- [ ] **Step 2: Commit**

```bash
git add skills/unity-indexer/SKILL.md
git commit -m "feat: rewrite SKILL.md as comprehensive auto-injected guide"
````

---

## Task 2: Create hooks/session-start and tests

**Files:**

- Create: `hooks/session-start`
- Create: `tests/hooks/hook.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/hooks/hook.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const HOOK = join(import.meta.dirname, "../../hooks/session-start");
const ROOT = join(import.meta.dirname, "../..");

function runHook(extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "CLAUDE_PLUGIN_ROOT" && k !== "CURSOR_PLUGIN_ROOT" && v !== undefined) {
      env[k] = v;
    }
  }
  return spawnSync("bash", [HOOK], { env: { ...env, ...extraEnv }, encoding: "utf8" });
}

describe("hooks/session-start", () => {
  it("emits Claude Code JSON when CLAUDE_PLUGIN_ROOT is set", () => {
    const result = runHook({ CLAUDE_PLUGIN_ROOT: ROOT });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("unity-indexer");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("get_scene_hierarchy");
  });

  it("emits Cursor JSON when CURSOR_PLUGIN_ROOT is set", () => {
    const result = runHook({ CURSOR_PLUGIN_ROOT: ROOT });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("additional_context");
    expect(typeof parsed.additional_context).toBe("string");
    expect(parsed.additional_context).toContain("unity-indexer");
    expect(parsed.additional_context).toContain("get_scene_hierarchy");
  });

  it("exits silently with no output when no harness env var is set", () => {
    const result = runHook();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("Claude Code output is valid JSON", () => {
    const result = runHook({ CLAUDE_PLUGIN_ROOT: ROOT });
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("Cursor output is valid JSON", () => {
    const result = runHook({ CURSOR_PLUGIN_ROOT: ROOT });
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- tests/hooks/hook.test.ts
```

Expected: FAIL — `hooks/session-start` does not exist yet.

- [ ] **Step 3: Create hooks/session-start**

Create `hooks/session-start` with this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  ROOT="$CLAUDE_PLUGIN_ROOT"
  HARNESS="claude"
elif [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  ROOT="$CURSOR_PLUGIN_ROOT"
  HARNESS="cursor"
else
  exit 0
fi

SKILL_FILE="$ROOT/skills/unity-indexer/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  exit 0
fi

if command -v python3 &>/dev/null; then
  ENCODED=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' < "$SKILL_FILE")
else
  ENCODED=$(node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)));' < "$SKILL_FILE")
fi

if [ "$HARNESS" = "cursor" ]; then
  printf '{"additional_context": %s}' "$ENCODED"
else
  printf '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s}}' "$ENCODED"
fi
```

- [ ] **Step 4: Make the script executable**

```bash
chmod +x hooks/session-start
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm run test -- tests/hooks/hook.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit with executable bit**

```bash
git add hooks/session-start tests/hooks/hook.test.ts
git update-index --chmod=+x hooks/session-start
git commit -m "feat: add hooks/session-start with harness detection and JSON emission"
```

---

## Task 3: Create hooks/hooks.json and hooks/hooks-cursor.json

**Files:**

- Create: `hooks/hooks.json`
- Create: `hooks/hooks-cursor.json`

No unit tests — JSON config files validated by the harnesses at runtime. Verified correct by checking against Superpowers' published format.

- [ ] **Step 1: Create hooks/hooks.json (Claude Code)**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Create hooks/hooks-cursor.json (Cursor)**

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "./hooks/session-start"
      }
    ]
  }
}
```

- [ ] **Step 3: Validate both files parse as JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('hooks.json OK')"
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks-cursor.json','utf8')); console.log('hooks-cursor.json OK')"
```

Expected:

```
hooks.json OK
hooks-cursor.json OK
```

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json hooks/hooks-cursor.json
git commit -m "feat: add hook registration files for Claude Code and Cursor"
```

---

## Task 4: Update .claude-plugin/plugin.json

**Files:**

- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add hooks field to .claude-plugin/plugin.json**

Current content of `.claude-plugin/plugin.json`:

```json
{
  "name": "unity-indexer",
  "description": "Token-efficient Unity project code explorer. Provides tools for searching scripts, finding references, inspecting types, and navigating Unity-specific patterns.",
  "author": {
    "name": "Bogdan Manta"
  }
}
```

Replace with:

```json
{
  "name": "unity-indexer",
  "description": "Token-efficient Unity project code explorer. Provides tools for searching scripts, finding references, inspecting types, and navigating Unity-specific patterns.",
  "author": {
    "name": "Bogdan Manta"
  },
  "hooks": "./hooks/hooks.json"
}
```

- [ ] **Step 2: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('plugin.json OK')"
```

Expected: `plugin.json OK`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: register SessionStart hook in Claude Code plugin manifest"
```

---

## Task 5: Create .cursor-plugin/plugin.json and mcp.json

**Files:**

- Create: `.cursor-plugin/plugin.json`
- Create: `mcp.json`

- [ ] **Step 1: Create .cursor-plugin/plugin.json**

```bash
mkdir -p .cursor-plugin
```

Create `.cursor-plugin/plugin.json`:

```json
{
  "name": "unity-indexer",
  "displayName": "Unity Indexer",
  "version": "0.1.0",
  "description": "Token-efficient Unity project code explorer. Provides tools for searching scripts, finding references, inspecting types, and navigating Unity-specific patterns.",
  "author": {
    "name": "Bogdan Manta"
  },
  "skills": "./skills/",
  "hooks": "./hooks/hooks-cursor.json",
  "mcpServers": "./mcp.json"
}
```

- [ ] **Step 2: Create mcp.json at repo root**

```json
{
  "mcpServers": {
    "unity-indexer": {
      "command": "npx",
      "args": ["unity-indexer"]
    }
  }
}
```

- [ ] **Step 3: Validate both files parse as JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('.cursor-plugin/plugin.json','utf8')); console.log('.cursor-plugin/plugin.json OK')"
node -e "JSON.parse(require('fs').readFileSync('mcp.json','utf8')); console.log('mcp.json OK')"
```

Expected:

```
.cursor-plugin/plugin.json OK
mcp.json OK
```

- [ ] **Step 4: Commit**

```bash
git add .cursor-plugin/plugin.json mcp.json
git commit -m "feat: add Cursor plugin manifest and MCP server declaration"
```

---

## Task 6: Update package.json files field

**Files:**

- Modify: `package.json`

Skills and hooks must be included in the npm package so plugin installs can access them via `$CLAUDE_PLUGIN_ROOT` and `$CURSOR_PLUGIN_ROOT`.

- [ ] **Step 1: Update the files field in package.json**

Find the current `"files"` field:

```json
"files": [
  "dist/"
]
```

Replace with:

```json
"files": [
  "dist/",
  "skills/",
  "hooks/",
  "mcp.json"
]
```

- [ ] **Step 2: Verify npm pack includes the new paths**

```bash
npm pack --dry-run 2>&1 | grep -E "skills/|hooks/|mcp\.json"
```

Expected output includes lines like:

```
skills/unity-indexer/SKILL.md
hooks/session-start
hooks/hooks.json
hooks/hooks-cursor.json
mcp.json
```

- [ ] **Step 3: Run full test suite to confirm nothing broken**

```bash
npm run ci
```

Expected: all checks pass (typecheck, lint, format, test, build).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: include skills, hooks, and mcp.json in npm package"
```

---

## Task 7: Final verification

**Files:** none modified

- [ ] **Step 1: Run full test suite one final time**

```bash
npm run test
```

Expected: all tests pass including the new `tests/hooks/hook.test.ts`.

- [ ] **Step 2: Confirm hooks/session-start is executable**

```bash
ls -la hooks/session-start
```

Expected: `-rwxr-xr-x` (executable bit set).

- [ ] **Step 3: Smoke-test Claude Code output manually**

```bash
CLAUDE_PLUGIN_ROOT=$(pwd) bash hooks/session-start | python3 -m json.tool > /dev/null && echo "Claude Code output: valid JSON"
```

Expected: `Claude Code output: valid JSON`

- [ ] **Step 4: Smoke-test Cursor output manually**

```bash
CURSOR_PLUGIN_ROOT=$(pwd) bash hooks/session-start | python3 -m json.tool > /dev/null && echo "Cursor output: valid JSON"
```

Expected: `Cursor output: valid JSON`

- [ ] **Step 5: Confirm SKILL.md contains key tools from each category**

```bash
grep -q "get_scene_hierarchy" skills/unity-indexer/SKILL.md && \
grep -q "get_script_detail" skills/unity-indexer/SKILL.md && \
grep -q "find_references" skills/unity-indexer/SKILL.md && \
grep -q "trace_dependents" skills/unity-indexer/SKILL.md && \
grep -q "find_unused" skills/unity-indexer/SKILL.md && \
echo "SKILL.md contains all required tool categories"
```

Expected: `SKILL.md contains all required tool categories`

- [ ] **Step 6: Confirm npm pack includes skills, hooks, and mcp.json**

```bash
npm pack --dry-run 2>&1 | grep -E "skills/|hooks/|mcp\.json"
```

Expected lines (order may vary):

```
skills/unity-indexer/SKILL.md
hooks/session-start
hooks/hooks.json
hooks/hooks-cursor.json
mcp.json
```

Note: `.claude-plugin/` and `.cursor-plugin/` are intentionally NOT in `"files"` — the plugin install flow uses git clone from GitHub, not npm. The npm package only needs skills, hooks, and mcp.json for users who install via npm directly.
