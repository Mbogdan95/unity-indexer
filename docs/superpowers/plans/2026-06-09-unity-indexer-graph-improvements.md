# Unity Indexer Graph Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three benchmark gaps — empty inbound caller graph, missing implementors-of traversal, and opaque node IDs — without schema changes.

**Architecture:** Add a new `USES` edge type extracted from field/parameter/local-variable type declarations during script indexing; add a `resolveNodeLabel` helper in `graph-tools.ts` that decodes `script:42` → class name and apply it inline to all graph traversal tool responses; add `find_implementors` that queries incoming `IMPLEMENTS` edges; enrich `get_script_detail` with `file_path`, resolved class-name labels in relationships, and a new `used_by` array.

**Tech Stack:** TypeScript, tree-sitter-c_sharp (web-tree-sitter), better-sqlite3, graphology, Vitest

---

## File Map

| File                                           | Change                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                                 | Add `"USES"` to `GraphEdgeType` union                                                                   |
| `src/parsers/relationship-extractor.ts`        | Add `extractTypeReferences()` and helpers                                                               |
| `src/indexer/indexer.ts`                       | Import + call `extractTypeReferences()`, insert USES edges                                              |
| `src/db/store.ts`                              | Add `getScriptById(id)` method                                                                          |
| `src/mcp/graph-tools.ts`                       | Add `resolveNodeLabel()`, enrich node arrays in 4 handlers, add `handleFindImplementors` + registration |
| `src/mcp/tools.ts`                             | Enrich `handleGetScriptDetail`: add `file_path`, resolve labels, add `used_by`                          |
| `tests/parsers/relationship-extractor.test.ts` | New `extractTypeReferences` describe block                                                              |
| `tests/indexer/indexer.test.ts`                | New test asserting USES edges in graph                                                                  |
| `tests/db/store.test.ts`                       | New test for `getScriptById`                                                                            |
| `tests/mcp/graph-tools.test.ts`                | `label` field assertions + `handleFindImplementors` tests                                               |
| `tests/mcp/tools.test.ts`                      | New assertions on `get_script_detail` enrichment                                                        |

> **Note:** The spec listed 5 files; `src/db/store.ts` is a 6th because `graph-tools.ts` needs to resolve `script:N` IDs to class names, requiring a `getScriptById` lookup not previously on the Store.

---

## Task 1: Add USES edge type and `extractTypeReferences()`

**Files:**

- Modify: `src/types.ts`
- Modify: `src/parsers/relationship-extractor.ts`
- Modify: `tests/parsers/relationship-extractor.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `tests/parsers/relationship-extractor.test.ts`:

```typescript
import {
  extractRelationships,
  extractTypeReferences,
} from "../../src/parsers/relationship-extractor.js";

// (keep all existing imports and tests unchanged — append below)

describe("extractTypeReferences", () => {
  it("extracts field type references as USES edges", () => {
    // HealthSystem.cs has: private PlayerController controller;
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const refs = extractTypeReferences(content);
    const fieldRefs = refs.filter(
      (r) =>
        r.edgeType === "USES" &&
        r.sourceClassName === "HealthSystem" &&
        r.targetClassName === "PlayerController",
    );
    expect(fieldRefs.length).toBeGreaterThan(0);
  });

  it("extracts method parameter types as USES edges", () => {
    const content = `
public class MyClass {
  public void Init(PlayerController ctrl) {}
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some(
        (r) =>
          r.edgeType === "USES" &&
          r.sourceClassName === "MyClass" &&
          r.targetClassName === "PlayerController",
      ),
    ).toBe(true);
  });

  it("extracts local variable type declarations as USES edges", () => {
    const content = `
public class MyClass {
  void Foo() {
    PlayerController ctrl = null;
  }
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some(
        (r) =>
          r.edgeType === "USES" &&
          r.sourceClassName === "MyClass" &&
          r.targetClassName === "PlayerController",
      ),
    ).toBe(true);
  });

  it("ignores C# primitive types", () => {
    const content = `
public class MyClass {
  private int count;
  private string name;
  private bool flag;
  void Foo(float x) {}
}`;
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });

  it("ignores Unity built-in types", () => {
    const content = `
public class MyClass {
  private Rigidbody rb;
  private Animator anim;
  private Camera cam;
}`;
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });

  it("strips generic wrapper and extracts inner type", () => {
    const content = `
public class MyClass {
  private List<PlayerController> players;
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some((r) => r.edgeType === "USES" && r.targetClassName === "PlayerController"),
    ).toBe(true);
  });

  it("deduplicates identical source/target pairs", () => {
    const content = `
public class MyClass {
  private PlayerController ctrl1;
  private PlayerController ctrl2;
}`;
    const refs = extractTypeReferences(content);
    const dupes = refs.filter(
      (r) => r.sourceClassName === "MyClass" && r.targetClassName === "PlayerController",
    );
    expect(dupes).toHaveLength(1);
  });

  it("skips var (implicit type) declarations", () => {
    const content = `
public class MyClass {
  void Foo() {
    var x = new PlayerController();
  }
}`;
    const refs = extractTypeReferences(content);
    // var is unresolvable — should not emit USES for 'var'
    expect(refs.every((r) => r.targetClassName !== "var")).toBe(true);
  });

  it("returns empty array for interface-only file", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/IDamageable.cs"), "utf-8");
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/parsers/relationship-extractor.test.ts
```

Expected: 9 new tests FAIL with `extractTypeReferences is not a function` or similar.

- [ ] **Step 3: Add `"USES"` to `GraphEdgeType` in `src/types.ts`**

Find the `GraphEdgeType` union (around line 357) and add `"USES"`:

```typescript
export type GraphEdgeType =
  | "INHERITS"
  | "IMPLEMENTS"
  | "ATTACHES_TO"
  | "SCRIPTED_BY"
  | "CHILD_OF"
  | "DEFINED_IN"
  | "REFERENCES_GUID"
  | "VARIANT_OF"
  | "BELONGS_TO"
  | "CALLS"
  | "SUBSCRIBES_TO"
  | "ASSEMBLY_DEPENDS"
  | "USES";
```

- [ ] **Step 4: Implement `extractTypeReferences()` in `src/parsers/relationship-extractor.ts`**

Add after the existing `UNITY_BUILTIN_TYPES` set (before `isUppercase`):

```typescript
const CS_PRIMITIVE_KEYWORDS = new Set([
  "int",
  "float",
  "bool",
  "string",
  "double",
  "long",
  "void",
  "byte",
  "char",
  "object",
  "var",
  "uint",
  "ushort",
  "short",
  "sbyte",
  "decimal",
]);
```

Add this helper function before `extractRelationships`:

```typescript
function isFilteredType(name: string): boolean {
  return UNITY_BUILTIN_TYPES.has(name) || CS_PRIMITIVE_KEYWORDS.has(name);
}

function typeNamesFromNode(typeNode: Node): string[] {
  switch (typeNode.type) {
    case "identifier":
      return [typeNode.text];
    case "generic_name": {
      // List<T>, Dictionary<K,V> — skip outer name, recurse into type args
      const typeArgList = typeNode.namedChildren.find((c) => c.type === "type_argument_list");
      if (!typeArgList) return [];
      const names: string[] = [];
      for (const arg of typeArgList.namedChildren) {
        if (arg.type === "identifier" || arg.type === "generic_name") {
          names.push(...typeNamesFromNode(arg));
        }
      }
      return names;
    }
    case "array_type": {
      const inner = typeNode.childForFieldName("type");
      return inner ? typeNamesFromNode(inner) : [];
    }
    case "nullable_type": {
      const inner = typeNode.namedChildren[0];
      return inner ? typeNamesFromNode(inner) : [];
    }
    default:
      return [];
  }
}
```

Add this exported function at the end of the file (before `tree.delete()` pattern does not apply — add as new top-level export):

```typescript
export function extractTypeReferences(content: string): ExtractedRelationship[] {
  const parser = getParser();
  if (!parser) {
    throw new Error("Script parser not initialized. Call initScriptParser() first.");
  }

  const tree = parser.parse(content);
  if (!tree) return [];

  const results: ExtractedRelationship[] = [];
  const classBodies = collectClassBodies(tree.rootNode);

  walkAll(tree.rootNode, (node) => {
    const sourceClassName = findSourceClass(node.startIndex, classBodies);
    if (!sourceClassName) return;

    let typeNodes: Node[] = [];

    // Pattern 1: field declarations — private T _field;
    if (node.type === "field_declaration") {
      const varDecl = node.namedChildren.find((c) => c.type === "variable_declaration");
      if (varDecl) {
        const typeNode = varDecl.childForFieldName("type");
        if (typeNode) typeNodes.push(typeNode);
      }
    }

    // Pattern 2: method parameters — void Foo(T param) {}
    if (node.type === "parameter") {
      const typeNode = node.childForFieldName("type");
      if (typeNode) typeNodes.push(typeNode);
    }

    // Pattern 3: local variable declarations — T x = ...;
    if (node.type === "local_declaration_statement") {
      const varDecl = node.namedChildren.find((c) => c.type === "variable_declaration");
      if (varDecl) {
        const typeNode = varDecl.childForFieldName("type");
        if (typeNode) typeNodes.push(typeNode);
      }
    }

    for (const typeNode of typeNodes) {
      for (const name of typeNamesFromNode(typeNode)) {
        if (isUppercase(name) && !isFilteredType(name)) {
          results.push({
            sourceClassName,
            edgeType: "USES",
            targetClassName: name,
          });
        }
      }
    }
  });

  // Deduplicate
  const seen = new Set<string>();
  const deduped: ExtractedRelationship[] = [];
  for (const rel of results) {
    const key = `${rel.sourceClassName}|${rel.edgeType}|${rel.targetClassName}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(rel);
    }
  }

  tree.delete();
  return deduped;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- tests/parsers/relationship-extractor.test.ts
```

Expected: all tests PASS (existing + 9 new).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/parsers/relationship-extractor.ts tests/parsers/relationship-extractor.test.ts
git commit -m "feat: add USES edge type and extractTypeReferences() for high-recall dependency graph"
```

---

## Task 2: Wire `extractTypeReferences()` in the indexer

**Files:**

- Modify: `src/indexer/indexer.ts`
- Modify: `tests/indexer/indexer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/indexer/indexer.test.ts` inside the `describe("Indexer", ...)` block:

```typescript
import { encodeNodeId } from "../../src/types.js";

// Add inside describe("Indexer", () => { ... })

it("indexes USES edges from field type declarations", () => {
  indexer.indexAll();

  // HealthSystem.cs has: private PlayerController controller;
  // so HealthSystem USES PlayerController should be in the graph
  const healthSystem = store.getScriptByClassName("HealthSystem");
  const playerController = store.getScriptByClassName("PlayerController");
  expect(healthSystem).toBeDefined();
  expect(playerController).toBeDefined();

  const hsNodeId = encodeNodeId("script", healthSystem!.id);
  const pcNodeId = encodeNodeId("script", playerController!.id);

  const outgoing = store.graph.getOutgoing(hsNodeId, ["USES"]);
  expect(outgoing.some((n) => n.nodeId === pcNodeId)).toBe(true);
});
```

> The import for `encodeNodeId` should be added at the top of the file alongside the existing imports.

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/indexer/indexer.test.ts
```

Expected: new test FAILS (`outgoing` is empty or `USES` edges not in graph).

- [ ] **Step 3: Implement — add `extractTypeReferences` call in `indexScript()`**

In `src/indexer/indexer.ts`, update the import at the top:

```typescript
import { extractRelationships, extractTypeReferences } from "../parsers/relationship-extractor.js";
```

Then in `indexScript()`, after the existing `extractRelationships` block (around line 524):

```typescript
// Existing block (keep unchanged):
const relationships = extractRelationships(content);
for (const rel of relationships) {
  const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
  const targetScript = this.store.getScriptByClassName(rel.targetClassName);
  if (sourceScript && targetScript) {
    this.insertEdge("script", sourceScript.id, "script", targetScript.id, rel.edgeType, fileId);
  }
}

// New block — add immediately after:
const typeRefs = extractTypeReferences(content);
for (const rel of typeRefs) {
  const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
  const targetScript = this.store.getScriptByClassName(rel.targetClassName);
  if (sourceScript && targetScript) {
    this.insertEdge("script", sourceScript.id, "script", targetScript.id, rel.edgeType, fileId);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/indexer/indexer.test.ts
```

Expected: all tests PASS including new USES edge test.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all 238 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/indexer.ts tests/indexer/indexer.test.ts
git commit -m "feat: index USES edges from field/param/local type declarations"
```

---

## Task 3: Add `getScriptById` to Store + `resolveNodeLabel` + graph tool enrichment

**Files:**

- Modify: `src/db/store.ts`
- Modify: `src/mcp/graph-tools.ts`
- Modify: `tests/db/store.test.ts`
- Modify: `tests/mcp/graph-tools.test.ts`

- [ ] **Step 1: Write the failing store test**

Open `tests/db/store.test.ts` and append a test inside the existing describe block (or add a new one):

```typescript
it("getScriptById returns script row", () => {
  // Requires an indexed store — use the full fixture indexer
  const Indexer = (await import("../../src/indexer/indexer.js")).Indexer;
  const indexer = new Indexer(store, FIXTURES);
  indexer.indexAll();
  const pc = store.getScriptByClassName("PlayerController");
  expect(pc).toBeDefined();
  const byId = store.getScriptById(pc!.id);
  expect(byId).toBeDefined();
  expect(byId!.class_name).toBe("PlayerController");
});
```

> Check the existing import pattern in `tests/db/store.test.ts` — if `FIXTURES` and `Indexer` are not already imported there, look at how `tests/indexer/indexer.test.ts` does it and mirror that pattern. The constant is `join(import.meta.dirname, "../fixtures/TestProject")`.

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/db/store.test.ts
```

Expected: FAIL with `store.getScriptById is not a function`.

- [ ] **Step 3: Add `getScriptById` to `src/db/store.ts`**

In the Scripts section of `store.ts`, add after `getScriptByFileId`:

```typescript
  getScriptById(id: number): (ScriptRow & { id: number }) | undefined {
    const row = this.prepare("SELECT * FROM scripts WHERE id = ? LIMIT 1").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? scriptRowOut(row) : undefined;
  }
```

- [ ] **Step 4: Write the failing graph-tools test for `label` field**

In `tests/mcp/graph-tools.test.ts`, update the `handleTraceDependencies` test to assert `label` exists:

```typescript
describe("handleTraceDependencies", () => {
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
    // NEW: every node must have a label field
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
  });

  it("returns error for unknown identifier", () => {
    const result = handleTraceDependencies(store, {
      identifier: "NonExistent",
      depth: 2,
    }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });
});
```

Also update `handleTraceDependents`:

```typescript
describe("handleTraceDependents", () => {
  it("returns dependents for a script with label fields", () => {
    const result = handleTraceDependents(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
  });
});
```

And `handleGetSubgraph`:

```typescript
describe("handleGetSubgraph", () => {
  it("returns neighborhood with label fields", () => {
    const result = handleGetSubgraph(store, {
      identifier: "PlayerController",
      radius: 1,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests to confirm they fail**

```bash
npm test -- tests/db/store.test.ts tests/mcp/graph-tools.test.ts
```

Expected: store test FAILS (getScriptById missing), graph-tools label tests FAIL.

After adding `getScriptById` in Step 3, re-run — store test should now pass, graph-tools label tests still fail.

- [ ] **Step 6: Add `resolveNodeLabel` and apply it in `src/mcp/graph-tools.ts`**

Add this helper function near the top of `graph-tools.ts`, after the imports:

```typescript
function resolveNodeLabel(store: Store, nodeId: string): string {
  const { type, id } = decodeNodeId(nodeId);
  switch (type) {
    case "script": {
      const script = store.getScriptById(id);
      return script?.class_name ?? nodeId;
    }
    case "file": {
      const file = store.getFileById(id);
      return file?.path ?? nodeId;
    }
    case "game_object": {
      const go = store.getGameObjectById(id);
      return go?.name ?? nodeId;
    }
    case "assembly": {
      const asms = store.listAssemblies();
      const asm = asms.find((a) => a.id === id);
      return asm?.name ?? nodeId;
    }
    default:
      return nodeId;
  }
}
```

Update `handleTraceDependencies` node mapping:

```typescript
const response = {
  nodes: result.nodes.map((n) => ({
    id: n.id,
    type: decodeNodeId(n.id).type,
    depth: n.depth,
    label: resolveNodeLabel(store, n.id),
  })),
  edges: result.edges,
  summary: `${params.identifier} has ${String(result.nodes.length - 1)} transitive dependencies across ${String(depth)} levels`,
};
```

Update `handleTraceDependents` node mapping the same way:

```typescript
const response = {
  nodes: result.nodes.map((n) => ({
    id: n.id,
    type: decodeNodeId(n.id).type,
    depth: n.depth,
    label: resolveNodeLabel(store, n.id),
  })),
  edges: result.edges,
  summary: `${String(result.nodes.length - 1)} things depend on ${params.identifier} within ${String(depth)} levels`,
};
```

Update `handleGetSubgraph` node mapping the same way:

```typescript
const response = {
  nodes: result.nodes.map((n) => ({
    id: n.id,
    type: decodeNodeId(n.id).type,
    depth: n.depth,
    label: resolveNodeLabel(store, n.id),
  })),
  edges: result.edges,
  summary: `${String(result.nodes.length)} nodes within radius ${String(radius)} of ${params.identifier}`,
};
```

Update `handleFindPath` to enrich path nodes (current `path: result.nodes` is a `string[]` — change it to objects):

```typescript
const response = {
  path: result.nodes.map((nodeId) => ({
    id: nodeId,
    type: decodeNodeId(nodeId).type,
    label: resolveNodeLabel(store, nodeId),
  })),
  edges: result.edges,
  summary: `Path of length ${String(result.nodes.length - 1)} from ${params.from} to ${params.to}`,
};
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npm test -- tests/db/store.test.ts tests/mcp/graph-tools.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db/store.ts src/mcp/graph-tools.ts tests/db/store.test.ts tests/mcp/graph-tools.test.ts
git commit -m "feat: add resolveNodeLabel to graph tools, enrich node arrays with label field"
```

---

## Task 4: Add `find_implementors` tool

**Files:**

- Modify: `src/mcp/graph-tools.ts`
- Modify: `tests/mcp/graph-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp/graph-tools.test.ts`:

```typescript
// Add to imports at top:
import { handleFindImplementors } from "../../src/mcp/graph-tools.js";

// Append new describe block:
describe("handleFindImplementors", () => {
  it("returns implementors for IDamageable", () => {
    // PlayerController.cs declares: public class PlayerController : MonoBehaviour, IDamageable
    const result = handleFindImplementors(store, {
      interface_name: "IDamageable",
    }) as Record<string, unknown>;

    expect(result.interface_name).toBe("IDamageable");
    expect(result.implementors).toBeDefined();
    const implementors = result.implementors as Array<Record<string, unknown>>;
    expect(implementors.length).toBeGreaterThan(0);
    const pc = implementors.find((i) => i.class_name === "PlayerController");
    expect(pc).toBeDefined();
    expect(typeof pc!.file_path).toBe("string");
    expect((pc!.file_path as string).endsWith(".cs")).toBe(true);
  });

  it("returns error for unknown interface", () => {
    const result = handleFindImplementors(store, {
      interface_name: "INonExistent",
    }) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });

  it("returns empty implementors for class with no implementors", () => {
    // HealthSystem is a class, not an interface — no one IMPLEMENTs it
    const result = handleFindImplementors(store, {
      interface_name: "HealthSystem",
    }) as Record<string, unknown>;

    // Not an error (HealthSystem is a valid script) — just 0 implementors
    expect(result.error).toBeUndefined();
    const implementors = result.implementors as Array<Record<string, unknown>>;
    expect(implementors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/mcp/graph-tools.test.ts
```

Expected: new tests FAIL with `handleFindImplementors is not a function`.

- [ ] **Step 3: Implement `handleFindImplementors` in `src/mcp/graph-tools.ts`**

Add the exported handler function before `registerGraphTools`:

```typescript
export function handleFindImplementors(store: Store, params: { interface_name: string }): object {
  const script = store.getScriptByClassName(params.interface_name);
  if (!script) {
    return { token_hint: 10, error: `Script not found: ${params.interface_name}` };
  }

  const nodeId = encodeNodeId("script", script.id);
  const incoming = store.graph.getIncoming(nodeId, ["IMPLEMENTS"]);

  const implementors = incoming
    .map((n) => {
      const { type, id } = decodeNodeId(n.nodeId);
      if (type !== "script") return null;
      const implScript = store.getScriptById(id);
      if (!implScript) return null;
      const file = store.getFileById(implScript.file_id);
      return {
        class_name: implScript.class_name,
        file_path: file?.path ?? "",
        ...(implScript.namespace ? { namespace: implScript.namespace } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const response = {
    interface_name: params.interface_name,
    implementors,
    total: implementors.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}
```

Register it inside `registerGraphTools()`, at the end before the closing `}`:

```typescript
server.registerTool(
  "find_implementors",
  {
    description:
      "Find all classes that implement a given interface. Answers: 'who implements IMyInterface?'",
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/mcp/graph-tools.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/graph-tools.ts tests/mcp/graph-tools.test.ts
git commit -m "feat: add find_implementors MCP tool for interface implementor traversal"
```

---

## Task 5: Enrich `get_script_detail`

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/mcp/tools.test.ts`, update the `handleGetScriptDetail` describe block. Replace the existing `"includes relationships from graph"` test and add new ones:

```typescript
describe("handleGetScriptDetail", () => {
  it("returns class_name=PlayerController with members having signature", () => {
    const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
      string,
      unknown
    >;
    expect(result.class_name).toBe("PlayerController");
    expect(result.members).toBeDefined();
    const members = result.members as Array<Record<string, unknown>>;
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]).toHaveProperty("signature");
  });

  it("returns error for unknown class", () => {
    const result = handleGetScriptDetail(store, { class_name: "NonExistent" }) as Record<
      string,
      unknown
    >;
    expect(result.error).toBeDefined();
  });

  it("includes file_path in response", () => {
    const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
      string,
      unknown
    >;
    expect(typeof result.file_path).toBe("string");
    expect((result.file_path as string).endsWith(".cs")).toBe(true);
  });

  it("relationships use class names not raw node IDs", () => {
    const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
      string,
      unknown
    >;
    const rels = result.relationships as Record<string, unknown>;
    // implements should be class names like "IDamageable", not "script:N"
    const implementsArr = rels.implements as string[];
    expect(implementsArr.length).toBeGreaterThan(0);
    expect(implementsArr.every((s) => !s.startsWith("script:"))).toBe(true);
    expect(implementsArr).toContain("IDamageable");
  });

  it("includes used_by array in relationships", () => {
    // HealthSystem has: private PlayerController controller;
    // so PlayerController.relationships.used_by should include HealthSystem
    const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
      string,
      unknown
    >;
    const rels = result.relationships as Record<string, unknown>;
    expect(rels).toHaveProperty("used_by");
    const usedBy = rels.used_by as string[];
    expect(usedBy).toContain("HealthSystem");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: `file_path`, resolved class names, and `used_by` tests FAIL.

- [ ] **Step 3: Implement enrichment in `src/mcp/tools.ts`**

At the top of `tools.ts`, add `decodeNodeId` to the existing import from `../types.js`:

```typescript
import { encodeNodeId, decodeNodeId } from "../types.js";
```

Add this inline helper before `handleGetScriptDetail` (not exported — only needed here):

```typescript
function resolveScriptNodeId(store: Store, nodeId: string): string {
  const { type, id } = decodeNodeId(nodeId);
  if (type !== "script") return nodeId;
  const script = store.getScriptById(id);
  return script?.class_name ?? nodeId;
}
```

Replace the `handleGetScriptDetail` function body. The key changes are: add `file_path`, replace `.map(n => n.nodeId)` with `.map(n => resolveScriptNodeId(store, n.nodeId))`, and add `used_by`. Here is the full updated function:

```typescript
export function handleGetScriptDetail(store: Store, params: { class_name: string }): object {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) {
    return { token_hint: 10, error: `Script not found: ${params.class_name}` };
  }

  const members = store.getScriptMembers(script.id);
  const file = store.getFileById(script.file_id);

  const response = {
    class_name: script.class_name,
    file_path: file?.path ?? "",
    ...(script.namespace ? { namespace: script.namespace } : {}),
    ...(script.base_class ? { base_class: script.base_class } : {}),
    interfaces: JSON.parse(script.interfaces) as string[],
    ...(script.assembly_name ? { assembly_name: script.assembly_name } : {}),
    api_summary: script.api_summary,
    ...(script.is_monobehaviour ? { is_monobehaviour: true } : {}),
    ...(script.is_editor_script ? { is_editor_script: true } : {}),
    ...(script.is_scriptable_object ? { is_scriptable_object: true } : {}),
    ...(script.is_generated ? { is_generated: true } : {}),
    complexity: script.complexity_score,
    members: members.map((m) => {
      const attrs = JSON.parse(m.attributes) as string[];
      return {
        name: m.name,
        kind: m.kind,
        ...(m.access !== "public" ? { access: m.access } : {}),
        signature: m.signature,
        ...(attrs.length > 0 ? { attributes: attrs } : {}),
        ...(m.has_serialize_field ? { has_serialize_field: true } : {}),
      };
    }),
  };

  const scriptNodeId = encodeNodeId("script", script.id);
  const outgoing = store.graph.getOutgoing(scriptNodeId);
  const incoming = store.graph.getIncoming(scriptNodeId);

  const relationships = {
    inherits: outgoing
      .filter((n) => n.edgeType === "INHERITS")
      .map((n) => resolveScriptNodeId(store, n.nodeId)),
    implements: outgoing
      .filter((n) => n.edgeType === "IMPLEMENTS")
      .map((n) => resolveScriptNodeId(store, n.nodeId)),
    callees: outgoing
      .filter((n) => n.edgeType === "CALLS")
      .map((n) => resolveScriptNodeId(store, n.nodeId)),
    callers: incoming
      .filter((n) => n.edgeType === "CALLS")
      .map((n) => resolveScriptNodeId(store, n.nodeId)),
    used_by: incoming
      .filter((n) => n.edgeType === "USES")
      .map((n) => resolveScriptNodeId(store, n.nodeId)),
  };

  return { token_hint: estimateTokens({ ...response, relationships }), ...response, relationships };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: enrich get_script_detail with file_path, resolved labels, and used_by"
```

---

## Spec Coverage Check

| Spec requirement                                            | Task                    |
| ----------------------------------------------------------- | ----------------------- |
| Add `"USES"` to `GraphEdgeType`                             | Task 1 Step 3           |
| `extractTypeReferences()` — field declarations              | Task 1 Step 4 Pattern 1 |
| `extractTypeReferences()` — method parameters               | Task 1 Step 4 Pattern 2 |
| `extractTypeReferences()` — local variable declarations     | Task 1 Step 4 Pattern 3 |
| Filter UNITY_BUILTIN_TYPES + CS_PRIMITIVE_KEYWORDS          | Task 1 Step 4           |
| Deduplicate                                                 | Task 1 Step 4           |
| Indexer calls `extractTypeReferences()`, inserts USES edges | Task 2 Step 3           |
| `resolveNodeLabel(store, nodeId)` helper                    | Task 3 Step 6           |
| `label` field on `trace_dependencies` nodes                 | Task 3 Step 6           |
| `label` field on `trace_dependents` nodes                   | Task 3 Step 6           |
| `label` field on `get_subgraph` nodes                       | Task 3 Step 6           |
| `label` field on `find_path` path nodes                     | Task 3 Step 6           |
| `getScriptById` on Store                                    | Task 3 Step 3           |
| `handleFindImplementors` handler                            | Task 4 Step 3           |
| `find_implementors` MCP registration                        | Task 4 Step 3           |
| `get_script_detail` — `file_path` field                     | Task 5 Step 3           |
| `get_script_detail` — resolved class names in relationships | Task 5 Step 3           |
| `get_script_detail` — `used_by` array                       | Task 5 Step 3           |

> **Re-indexing note:** After deploying, existing indexed databases will not have USES edges until users re-run `unity-indexer index <project-path>`.
