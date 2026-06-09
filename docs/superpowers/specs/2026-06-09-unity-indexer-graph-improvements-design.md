# Unity Indexer Graph Improvements Design

**Date:** 2026-06-09

## Problem

Benchmark results show the indexer scores 2/5 on full answers vs. grep/read at 4/5. Three root causes:

1. **Inbound caller graph is empty.** `trace_dependents`, `find_references`, and `callers` in `get_script_detail` return zero results for controller-level classes. The relationship extractor only captures static-receiver method calls, `GetComponent<T>`, constructors, and event subscriptions — missing the most common pattern (instance calls through typed fields/params).
2. **No `implementors_of` traversal.** `IMPLEMENTS` edges exist in the graph but no tool exposes incoming traversal on them. "Which classes implement IMyInterface?" is unanswerable.
3. **Node IDs are opaque.** Graph traversal results return `script:42`, `file:17` — not class names or file paths. Extra tool calls required to resolve them.

## Scope

Five files. No schema changes. Three independent features.

```
src/types.ts
src/parsers/relationship-extractor.ts
src/indexer/indexer.ts
src/mcp/tools.ts
src/mcp/graph-tools.ts
```

---

## Feature 1: `USES` Edge Type via Type Reference Extraction

### New edge type

Add `"USES"` to `GraphEdgeType` in `src/types.ts`.

`USES` means: "class A declares a structural dependency on class B" — field type, method parameter type, or local variable type. High recall, some false positives (a field declared but never called still produces an edge). Kept separate from `CALLS` (which means an actual invocation was observed).

### New function: `extractTypeReferences()`

Location: `src/parsers/relationship-extractor.ts`

Same signature as `extractRelationships()`:

```ts
export function extractTypeReferences(content: string): ExtractedRelationship[];
```

Always emits `edgeType: "USES"`.

**Three AST patterns:**

**Pattern 1 — Field declarations**

```csharp
private SceneController _ctrl;         // → MyClass USES SceneController
public List<PlayerData> items;         // → MyClass USES PlayerData (strips generic wrapper)
[SerializeField] AudioSource _audio;   // filtered (UNITY_BUILTIN_TYPES)
```

AST node: `field_declaration` → `variable_declaration` → type node text.

**Pattern 2 — Method parameters**

```csharp
void Init(SceneController ctrl) {}     // → MyClass USES SceneController
void Foo(int x, PlayerData d) {}       // → MyClass USES PlayerData (int filtered)
```

AST node: `method_declaration` → `parameter_list` → `parameter` → type node text.

**Pattern 3 — Local variable declarations**

```csharp
SceneController ctrl = GetComponent<SceneController>();  // → MyClass USES SceneController
var x = something;                                        // skipped (var unresolvable)
```

AST node: `local_declaration_statement` → `variable_declaration` → type node text.

**Filtering — two exclusion layers:**

- Existing `UNITY_BUILTIN_TYPES` set
- New `CS_PRIMITIVE_KEYWORDS`: `int float bool string double long void byte char object var uint ushort short sbyte decimal`

**Not captured (intentional):**

- Method return types (declaration site, not use site — too noisy)
- Catch clause types
- Generic type constraints

**Deduplication:** same `(sourceClass, USES, targetClass)` key as the existing deduper in `extractRelationships`.

### Indexer change

In `indexer.ts` `indexScript()`, after the existing `extractRelationships()` block:

```ts
const typeRefs = extractTypeReferences(content);
for (const rel of typeRefs) {
  const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
  const targetScript = this.store.getScriptByClassName(rel.targetClassName);
  if (sourceScript && targetScript) {
    this.insertEdge("script", sourceScript.id, "script", targetScript.id, rel.edgeType, fileId);
  }
}
```

---

## Feature 2: Node ID Resolution

### New helper: `resolveNodeLabel(store, nodeId): string`

Location: `src/mcp/graph-tools.ts`

Decodes the encoded node ID and looks up the human-readable label:

| Node type     | Lookup               | Label                              |
| ------------- | -------------------- | ---------------------------------- |
| `script`      | `scripts.class_name` | `"SceneManagementController"`      |
| `file`        | `files.path`         | `"Assets/Scripts/Scene/Loader.cs"` |
| `game_object` | `game_objects.name`  | `"Player"`                         |
| `assembly`    | `assemblies.name`    | `"Game.Core"`                      |
| other         | —                    | raw node ID (fallback)             |

### Applied in four places

**1. `get_script_detail` — relationships section**

`callees`, `callers`, `inherits`, `implements` arrays change from raw node IDs to resolved class names:

```json
// Before
"callers": ["script:42", "script:71"]

// After
"callers": ["SceneBootstrapper", "LevelManager"]
```

New `used_by` array added: incoming `USES` edges resolved to class names.

**2. `get_script_detail` — new `file_path` field**

```ts
const file = store.getFileById(script.file_id);
// response gains: file_path: file?.path ?? ""
```

**3. Graph traversal tools — `label` field on nodes**

`trace_dependencies`, `trace_dependents`, `get_subgraph` — each node gains `label`:

```json
{ "id": "script:42", "type": "script", "depth": 1, "label": "SceneManagementController" }
```

Existing `id` field preserved — no breaking change.

**4. `find_path` — `label` on path nodes**

Same `label` addition to the path node array.

---

## Feature 3: `find_implementors` Tool

### Handler: `handleFindImplementors(store, { interface_name })`

Location: `src/mcp/graph-tools.ts`

1. Look up: `store.getScriptByClassName(interface_name)`
2. Not found → `{ error: "Script not found: IMyInterface" }`
3. Get incoming edges: `store.graph.getIncoming(nodeId, ["IMPLEMENTS"])`
4. Resolve each node to full script row, join with file path
5. Return:

```json
{
  "interface_name": "ISceneLoader",
  "implementors": [
    {
      "class_name": "SceneLoader",
      "file_path": "Assets/Scripts/Scene/SceneLoader.cs",
      "namespace": "Game.Scene"
    },
    {
      "class_name": "MockSceneLoader",
      "file_path": "Assets/Tests/MockSceneLoader.cs",
      "namespace": "Game.Tests"
    }
  ],
  "total": 2
}
```

### MCP registration

```ts
server.registerTool(
  "find_implementors",
  {
    description: "Find all classes that implement a given interface.",
    inputSchema: {
      interface_name: z.string().describe("Interface class name (e.g. 'ISceneLoader')"),
      project: z
        .string()
        .optional()
        .describe("Project name (required if multiple projects indexed)"),
    },
  },
  (params) => toContent(handleFindImplementors(resolveStore(params.project), params)),
);
```

Registered inside `registerGraphTools()`.

---

## Expected Benchmark Impact

| Gap                           | Before       | After                                    |
| ----------------------------- | ------------ | ---------------------------------------- |
| "Who calls SceneController?"  | 0 results    | USES-edge callers returned (high recall) |
| "Who implements ILoader?"     | unanswerable | `find_implementors` answers directly     |
| Graph traversal usability     | opaque IDs   | class names + file paths inline          |
| `get_script_detail` usability | no file path | `file_path` field added                  |

---

## Out of Scope

- Symbol table / full call graph resolution (Option C) — disproportionate complexity
- Method return type extraction — too noisy for recall gain
- Re-indexing existing databases — caller must re-run `unity-indexer index` to populate USES edges
