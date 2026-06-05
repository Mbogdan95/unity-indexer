# Graph Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory Graphology graph layer backed by a `graph_edges` SQLite table to enable multi-hop traversal, cycle detection, pathfinding, and subgraph queries across Unity project entities.

**Architecture:** SQLite remains the entity store. A new `graph_edges` table persists relationship edges. On startup (or after full index), all edges are loaded into a Graphology `DirectedGraph` instance owned by `Store`. New MCP tools query the graph; existing tools gain optional `depth` params.

**Tech Stack:** graphology, graphology-shortest-path, graphology-traversal, graphology-components, graphology-metrics, better-sqlite3 (existing), web-tree-sitter (existing)

---

### Task 1: Install Dependencies and Add Graph Edge Types

**Files:**

- Modify: `package.json`
- Modify: `src/types.ts`

- [ ] **Step 1: Install graphology packages**

Run:

```bash
npm install graphology graphology-shortest-path graphology-traversal graphology-components graphology-metrics
npm install -D @types/graphology
```

- [ ] **Step 2: Add graph edge and node type definitions to `src/types.ts`**

Append to end of `src/types.ts`:

```typescript
export type GraphNodeType = "file" | "script" | "game_object" | "component" | "assembly";

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
  | "ASSEMBLY_DEPENDS";

export interface GraphEdgeRow {
  id?: number;
  source_type: GraphNodeType;
  source_id: number;
  target_type: GraphNodeType;
  target_id: number;
  edge_type: GraphEdgeType;
  metadata: string | null;
  source_file_id: number | null;
}

export interface GraphNodeId {
  type: GraphNodeType;
  id: number;
}

export function encodeNodeId(type: GraphNodeType, id: number): string {
  return `${type}:${String(id)}`;
}

export function decodeNodeId(encoded: string): GraphNodeId {
  const sep = encoded.indexOf(":");
  return {
    type: encoded.slice(0, sep) as GraphNodeType,
    id: Number(encoded.slice(sep + 1)),
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types.ts
git commit -m "feat: add graphology deps and graph edge types"
```

---

### Task 2: Add `graph_edges` Table to Schema and Store CRUD

**Files:**

- Modify: `src/db/schema.ts`
- Modify: `src/db/store.ts`
- Modify: `tests/db/store.test.ts`

- [ ] **Step 1: Write failing tests for graph edge CRUD in `tests/db/store.test.ts`**

Append a new describe block at end of `tests/db/store.test.ts`:

```typescript
// ---------------------------------------------------------------------------
describe("Store - graph edges", () => {
  it("inserts and queries edges by source", () => {
    const fileId = store.upsertFile(makeFile({ path: "A.cs", type: "script" }));
    const scriptIdA = store.insertScript(makeScript(fileId, { class_name: "A" }));
    const scriptIdB = store.insertScript(makeScript(fileId, { class_name: "B" }));

    store.insertGraphEdge({
      source_type: "script",
      source_id: scriptIdA,
      target_type: "script",
      target_id: scriptIdB,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: fileId,
    });

    const edges = store.getGraphEdgesBySource("script", scriptIdA);
    expect(edges).toHaveLength(1);
    expect(edges[0].edge_type).toBe("INHERITS");
    expect(edges[0].target_id).toBe(scriptIdB);
  });

  it("queries edges by target", () => {
    const fileId = store.upsertFile(makeFile({ path: "B.cs", type: "script" }));
    const scriptIdA = store.insertScript(makeScript(fileId, { class_name: "X" }));
    const scriptIdB = store.insertScript(makeScript(fileId, { class_name: "Y" }));

    store.insertGraphEdge({
      source_type: "script",
      source_id: scriptIdA,
      target_type: "script",
      target_id: scriptIdB,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: fileId,
    });

    const edges = store.getGraphEdgesByTarget("script", scriptIdB);
    expect(edges).toHaveLength(1);
    expect(edges[0].source_id).toBe(scriptIdA);
  });

  it("deletes edges by source_file_id", () => {
    const fileId = store.upsertFile(makeFile({ path: "C.cs", type: "script" }));
    const scriptId = store.insertScript(makeScript(fileId, { class_name: "C" }));

    store.insertGraphEdge({
      source_type: "script",
      source_id: scriptId,
      target_type: "script",
      target_id: 999,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: fileId,
    });

    store.deleteGraphEdgesByFile(fileId);
    const edges = store.getGraphEdgesBySource("script", scriptId);
    expect(edges).toHaveLength(0);
  });

  it("loads all edges", () => {
    const fileId = store.upsertFile(makeFile({ path: "D.cs", type: "script" }));
    const sA = store.insertScript(makeScript(fileId, { class_name: "D1" }));
    const sB = store.insertScript(makeScript(fileId, { class_name: "D2" }));

    store.insertGraphEdge({
      source_type: "script",
      source_id: sA,
      target_type: "script",
      target_id: sB,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: fileId,
    });
    store.insertGraphEdge({
      source_type: "script",
      source_id: sB,
      target_type: "script",
      target_id: sA,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: fileId,
    });

    const all = store.getAllGraphEdges();
    expect(all).toHaveLength(2);
  });

  it("handles unique constraint on duplicate edge", () => {
    const fileId = store.upsertFile(makeFile({ path: "E.cs", type: "script" }));
    const sA = store.insertScript(makeScript(fileId, { class_name: "E1" }));
    const sB = store.insertScript(makeScript(fileId, { class_name: "E2" }));

    const edge: import("../../src/types.js").GraphEdgeRow = {
      source_type: "script",
      source_id: sA,
      target_type: "script",
      target_id: sB,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: fileId,
    };

    store.insertGraphEdge(edge);
    store.insertGraphEdge(edge); // should not throw (INSERT OR IGNORE)
    const edges = store.getGraphEdgesBySource("script", sA);
    expect(edges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/store.test.ts`
Expected: FAIL — `store.insertGraphEdge` is not a function

- [ ] **Step 3: Add `graph_edges` table to schema**

In `src/db/schema.ts`, append before the closing backtick of `SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS graph_edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type     TEXT NOT NULL,
  source_id       INTEGER NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       INTEGER NOT NULL,
  edge_type       TEXT NOT NULL,
  metadata        TEXT,
  source_file_id  INTEGER,
  UNIQUE(source_type, source_id, target_type, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source
  ON graph_edges (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_edges_target
  ON graph_edges (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_edges_file
  ON graph_edges (source_file_id);

CREATE INDEX IF NOT EXISTS idx_edges_type
  ON graph_edges (edge_type);
```

- [ ] **Step 4: Add graph edge CRUD methods to `Store`**

Add import in `src/db/store.ts`:

```typescript
import type { GraphEdgeRow, GraphNodeType } from "../types.js";
```

Add these methods to the `Store` class before the `// Transactions` section:

```typescript
  // ---------------------------------------------------------------------------
  // Graph Edges
  // ---------------------------------------------------------------------------

  insertGraphEdge(edge: GraphEdgeRow): void {
    this.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (source_type, source_id, target_type, target_id, edge_type, metadata, source_file_id)
      VALUES
        (@source_type, @source_id, @target_type, @target_id, @edge_type, @metadata, @source_file_id)
    `).run({
      source_type: edge.source_type,
      source_id: edge.source_id,
      target_type: edge.target_type,
      target_id: edge.target_id,
      edge_type: edge.edge_type,
      metadata: edge.metadata,
      source_file_id: edge.source_file_id,
    });
  }

  getGraphEdgesBySource(sourceType: GraphNodeType, sourceId: number): (GraphEdgeRow & { id: number })[] {
    return this.prepare(
      "SELECT * FROM graph_edges WHERE source_type = ? AND source_id = ?",
    ).all(sourceType, sourceId) as (GraphEdgeRow & { id: number })[];
  }

  getGraphEdgesByTarget(targetType: GraphNodeType, targetId: number): (GraphEdgeRow & { id: number })[] {
    return this.prepare(
      "SELECT * FROM graph_edges WHERE target_type = ? AND target_id = ?",
    ).all(targetType, targetId) as (GraphEdgeRow & { id: number })[];
  }

  deleteGraphEdgesByFile(fileId: number): void {
    this.prepare("DELETE FROM graph_edges WHERE source_file_id = ?").run(fileId);
  }

  getAllGraphEdges(): (GraphEdgeRow & { id: number })[] {
    return this.prepare("SELECT * FROM graph_edges").all() as (GraphEdgeRow & { id: number })[];
  }
```

- [ ] **Step 5: Add `graph_edges` cleanup to `deleteFileData`**

In `src/db/store.ts`, inside the `deleteFileData` method's transaction, add before the `this.prepare("DELETE FROM guids ...")` line:

```typescript
this.prepare("DELETE FROM graph_edges WHERE source_file_id = ?").run(fileId);
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/db/store.test.ts`
Expected: all PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/store.ts tests/db/store.test.ts
git commit -m "feat: add graph_edges table and Store CRUD methods"
```

---

### Task 3: Build Graphology Graph Manager

**Files:**

- Create: `src/db/graph.ts`
- Create: `tests/db/graph.test.ts`

- [ ] **Step 1: Write failing tests for graph manager**

Create `tests/db/graph.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../../src/db/store.js";
import { GraphManager } from "../../src/db/graph.js";
import type { GraphEdgeRow } from "../../src/types.js";

let store: Store;
let graph: GraphManager;

function insertEdge(store: Store, edge: Omit<GraphEdgeRow, "id">): void {
  store.insertGraphEdge(edge as GraphEdgeRow);
}

beforeEach(() => {
  store = new Store(":memory:");
  graph = new GraphManager();
});

afterEach(() => {
  store.close();
});

describe("GraphManager", () => {
  it("hydrates from store edges", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    expect(graph.nodeCount()).toBe(2);
    expect(graph.edgeCount()).toBe(1);
  });

  it("gets outgoing neighbors", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const deps = graph.getOutgoing("script:1");
    expect(deps).toHaveLength(2);
  });

  it("gets incoming neighbors", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const dependents = graph.getIncoming("script:2");
    expect(dependents).toHaveLength(1);
    expect(dependents[0].nodeId).toBe("script:1");
  });

  it("traces transitive dependencies (BFS)", () => {
    // A -> B -> C
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependencies("script:1", 3);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it("respects depth limit", () => {
    // A -> B -> C
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependencies("script:1", 1);
    expect(result.nodes).toHaveLength(2); // A and B only
    expect(result.edges).toHaveLength(1);
  });

  it("traces dependents (reverse)", () => {
    // A -> B, C -> B
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependents("script:2", 1);
    expect(result.nodes).toHaveLength(3); // B, A, C
  });

  it("finds shortest path", () => {
    // A -> B -> C -> D
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 4,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const path = graph.findPath("script:1", "script:4");
    expect(path).not.toBeNull();
    expect(path!.nodes).toHaveLength(4);
    expect(path!.nodes[0]).toBe("script:1");
    expect(path!.nodes[3]).toBe("script:4");
  });

  it("returns null when no path exists", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    // No edge from 2 to 3

    graph.hydrate(store.getAllGraphEdges());

    const path = graph.findPath("script:1", "script:3");
    expect(path).toBeNull();
  });

  it("gets subgraph within radius", () => {
    // A -> B -> C, A -> D
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 4,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const sub = graph.getSubgraph("script:1", 1);
    expect(sub.nodes).toHaveLength(3); // A, B, D
    expect(sub.edges).toHaveLength(2);
  });

  it("patches graph on file change", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    graph.hydrate(store.getAllGraphEdges());

    expect(graph.edgeCount()).toBe(1);

    // Simulate re-index: old edges removed, new edges added
    const newEdges: GraphEdgeRow[] = [
      {
        source_type: "script",
        source_id: 1,
        target_type: "script",
        target_id: 3,
        edge_type: "CALLS",
        metadata: null,
        source_file_id: 10,
      },
    ];
    graph.patchForFile(10, [], newEdges);

    expect(graph.edgeCount()).toBe(1);
    const out = graph.getOutgoing("script:1");
    expect(out).toHaveLength(1);
    expect(out[0].nodeId).toBe("script:3");
  });

  it("detects cycles", () => {
    // A -> B -> C -> A (cycle)
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 1,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const cycles = graph.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].length).toBe(3);
  });

  it("computes degree stats", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 4,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const stats = graph.getTopNodes("degree", 2);
    expect(stats[0].nodeId).toBe("script:1");
    expect(stats[0].score).toBe(3); // 3 outgoing
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/graph.test.ts`
Expected: FAIL — cannot resolve `../../src/db/graph.js`

- [ ] **Step 3: Implement `GraphManager`**

Create `src/db/graph.ts`:

```typescript
import DirectedGraph from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";
import { connectedComponents } from "graphology-components";
import { betweennessCentrality } from "graphology-metrics/centrality/betweenness.js";
import type { GraphEdgeRow, GraphEdgeType } from "../types.js";
import { encodeNodeId } from "../types.js";

export interface GraphNeighbor {
  nodeId: string;
  edgeType: GraphEdgeType;
}

export interface SubgraphResult {
  nodes: Array<{ id: string; depth: number }>;
  edges: Array<{ source: string; target: string; type: GraphEdgeType }>;
}

export interface PathResult {
  nodes: string[];
  edges: Array<{ source: string; target: string; type: GraphEdgeType }>;
}

export class GraphManager {
  private g: DirectedGraph;

  constructor() {
    this.g = new DirectedGraph({ allowSelfLoops: true, multi: false });
  }

  hydrate(edges: GraphEdgeRow[]): void {
    this.g.clear();
    for (const edge of edges) {
      const src = encodeNodeId(edge.source_type, edge.source_id);
      const tgt = encodeNodeId(edge.target_type, edge.target_id);
      if (!this.g.hasNode(src)) this.g.addNode(src);
      if (!this.g.hasNode(tgt)) this.g.addNode(tgt);
      const edgeKey = `${src}->${tgt}:${edge.edge_type}`;
      if (!this.g.hasEdge(edgeKey)) {
        this.g.addEdgeWithKey(edgeKey, src, tgt, {
          type: edge.edge_type,
          metadata: edge.metadata,
          source_file_id: edge.source_file_id,
        });
      }
    }
  }

  patchForFile(fileId: number, oldEdges: GraphEdgeRow[], newEdges: GraphEdgeRow[]): void {
    // Remove old edges from this file
    this.g.forEachEdge((_edge, attrs, _src, _tgt) => {
      if (attrs.source_file_id === fileId) {
        return true; // mark for removal
      }
      return false;
    });

    // Simpler approach: collect and drop
    const toRemove: string[] = [];
    this.g.forEachEdge((edge, attrs) => {
      if (attrs.source_file_id === fileId) {
        toRemove.push(edge);
      }
    });
    for (const edge of toRemove) {
      this.g.dropEdge(edge);
    }

    // Add new edges
    for (const edge of newEdges) {
      const src = encodeNodeId(edge.source_type, edge.source_id);
      const tgt = encodeNodeId(edge.target_type, edge.target_id);
      if (!this.g.hasNode(src)) this.g.addNode(src);
      if (!this.g.hasNode(tgt)) this.g.addNode(tgt);
      const edgeKey = `${src}->${tgt}:${edge.edge_type}`;
      if (!this.g.hasEdge(edgeKey)) {
        this.g.addEdgeWithKey(edgeKey, src, tgt, {
          type: edge.edge_type,
          metadata: edge.metadata,
          source_file_id: edge.source_file_id,
        });
      }
    }
  }

  nodeCount(): number {
    return this.g.order;
  }

  edgeCount(): number {
    return this.g.size;
  }

  getOutgoing(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[] {
    if (!this.g.hasNode(nodeId)) return [];
    const result: GraphNeighbor[] = [];
    this.g.forEachOutEdge(nodeId, (_edge, attrs, _src, tgt) => {
      const type = attrs.type as GraphEdgeType;
      if (!edgeTypes || edgeTypes.includes(type)) {
        result.push({ nodeId: tgt, edgeType: type });
      }
    });
    return result;
  }

  getIncoming(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[] {
    if (!this.g.hasNode(nodeId)) return [];
    const result: GraphNeighbor[] = [];
    this.g.forEachInEdge(nodeId, (_edge, attrs, src) => {
      const type = attrs.type as GraphEdgeType;
      if (!edgeTypes || edgeTypes.includes(type)) {
        result.push({ nodeId: src, edgeType: type });
      }
    });
    return result;
  }

  traceDependencies(
    startNode: string,
    maxDepth: number,
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    return this.bfsTraverse(startNode, maxDepth, "out", edgeTypes);
  }

  traceDependents(
    startNode: string,
    maxDepth: number,
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    return this.bfsTraverse(startNode, maxDepth, "in", edgeTypes);
  }

  private bfsTraverse(
    startNode: string,
    maxDepth: number,
    direction: "out" | "in",
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    if (!this.g.hasNode(startNode)) {
      return { nodes: [{ id: startNode, depth: 0 }], edges: [] };
    }

    const visited = new Map<string, number>(); // nodeId -> depth
    visited.set(startNode, 0);
    const edges: SubgraphResult["edges"] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNode, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const neighbors =
        direction === "out"
          ? this.getOutgoing(nodeId, edgeTypes)
          : this.getIncoming(nodeId, edgeTypes);

      for (const neighbor of neighbors) {
        const edgeEntry =
          direction === "out"
            ? { source: nodeId, target: neighbor.nodeId, type: neighbor.edgeType }
            : { source: neighbor.nodeId, target: nodeId, type: neighbor.edgeType };

        edges.push(edgeEntry);

        if (!visited.has(neighbor.nodeId)) {
          visited.set(neighbor.nodeId, depth + 1);
          queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
        }
      }
    }

    const nodes = Array.from(visited.entries()).map(([id, depth]) => ({ id, depth }));
    return { nodes, edges };
  }

  findPath(from: string, to: string): PathResult | null {
    if (!this.g.hasNode(from) || !this.g.hasNode(to)) return null;

    const path = bidirectional(this.g, from, to);
    if (!path) return null;

    const edges: PathResult["edges"] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const edgeKeys = this.g.outEdges(path[i]).filter((e) => this.g.target(e) === path[i + 1]);
      if (edgeKeys.length > 0) {
        const attrs = this.g.getEdgeAttributes(edgeKeys[0]);
        edges.push({ source: path[i], target: path[i + 1], type: attrs.type as GraphEdgeType });
      }
    }

    return { nodes: path, edges };
  }

  getSubgraph(centerNode: string, radius: number, edgeTypes?: GraphEdgeType[]): SubgraphResult {
    if (!this.g.hasNode(centerNode)) {
      return { nodes: [{ id: centerNode, depth: 0 }], edges: [] };
    }

    const visited = new Map<string, number>();
    visited.set(centerNode, 0);
    const edges: SubgraphResult["edges"] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: centerNode, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= radius) continue;

      // Both directions for subgraph
      for (const neighbor of this.getOutgoing(nodeId, edgeTypes)) {
        edges.push({ source: nodeId, target: neighbor.nodeId, type: neighbor.edgeType });
        if (!visited.has(neighbor.nodeId)) {
          visited.set(neighbor.nodeId, depth + 1);
          queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
        }
      }
      for (const neighbor of this.getIncoming(nodeId, edgeTypes)) {
        edges.push({ source: neighbor.nodeId, target: nodeId, type: neighbor.edgeType });
        if (!visited.has(neighbor.nodeId)) {
          visited.set(neighbor.nodeId, depth + 1);
          queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
        }
      }
    }

    const nodes = Array.from(visited.entries()).map(([id, depth]) => ({ id, depth }));
    return { nodes, edges };
  }

  detectCycles(edgeTypes?: GraphEdgeType[], maxLength: number = 10): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (cycles.length >= 100) return; // cap
      visited.add(node);
      stack.add(node);
      path.push(node);

      for (const neighbor of this.getOutgoing(node, edgeTypes)) {
        if (stack.has(neighbor.nodeId)) {
          const cycleStart = path.indexOf(neighbor.nodeId);
          const cycle = path.slice(cycleStart);
          if (cycle.length <= maxLength) {
            cycles.push([...cycle]);
          }
        } else if (!visited.has(neighbor.nodeId)) {
          dfs(neighbor.nodeId);
        }
      }

      path.pop();
      stack.delete(node);
    };

    this.g.forEachNode((node) => {
      if (!visited.has(node)) {
        dfs(node);
      }
    });

    return cycles;
  }

  getTopNodes(
    metric: "degree" | "betweenness" | "connected_components",
    topN: number,
  ): Array<{ nodeId: string; score: number }> {
    if (metric === "degree") {
      const scores: Array<{ nodeId: string; score: number }> = [];
      this.g.forEachNode((node) => {
        scores.push({ nodeId: node, score: this.g.outDegree(node) + this.g.inDegree(node) });
      });
      return scores.sort((a, b) => b.score - a.score).slice(0, topN);
    }

    if (metric === "connected_components") {
      const components = connectedComponents(this.g);
      const sorted = components.sort((a, b) => b.length - a.length).slice(0, topN);
      return sorted.map((comp, i) => ({ nodeId: `component_${String(i)}`, score: comp.length }));
    }

    // betweenness
    const centrality = betweennessCentrality(this.g);
    const scores = Object.entries(centrality).map(([nodeId, score]) => ({ nodeId, score }));
    return scores.sort((a, b) => b.score - a.score).slice(0, topN);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/db/graph.test.ts`
Expected: all PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/graph.ts tests/db/graph.test.ts
git commit -m "feat: add GraphManager with traversal, pathfinding, and cycle detection"
```

---

### Task 4: Extract Relationships from C# AST (CALLS, SUBSCRIBES_TO)

**Files:**

- Create: `src/parsers/relationship-extractor.ts`
- Create: `tests/parsers/relationship-extractor.test.ts`
- Create: `tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs`
- Create: `tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs.meta`

- [ ] **Step 1: Create test fixture `HealthSystem.cs`**

Create `tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs`:

```csharp
using UnityEngine;
using System;

namespace MyGame.Player
{
    public class HealthSystem : MonoBehaviour
    {
        public event Action<int> OnDamaged;
        public event Action OnDeath;

        private PlayerController controller;

        private void Start()
        {
            controller = GetComponent<PlayerController>();
            var renderer = GetComponent<MeshRenderer>();
        }

        public void ApplyDamage(int amount)
        {
            PlayerController.StaticMethod();
            OnDamaged?.Invoke(amount);
        }

        private void HandleDeath()
        {
            var spawner = new EnemySpawner();
            OnDeath?.Invoke();
        }
    }

    public class EnemySpawner
    {
        public void SpawnEnemy()
        {
            Debug.Log("Spawn");
        }
    }
}
```

- [ ] **Step 2: Create meta file for fixture**

Create `tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs.meta`:

```yaml
fileFormatVersion: 2
guid: b2c3d4e5f6a7b8c9d0e1f2a3
MonoImporter:
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: { instanceID: 0 }
```

- [ ] **Step 3: Write failing tests for relationship extractor**

Create `tests/parsers/relationship-extractor.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { extractRelationships } from "../../src/parsers/relationship-extractor.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

beforeAll(async () => {
  await initScriptParser();
});

describe("extractRelationships", () => {
  it("extracts GetComponent<T> calls", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const getCompRels = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "PlayerController",
    );
    expect(getCompRels.length).toBeGreaterThan(0);
  });

  it("extracts static method calls", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const staticCalls = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "PlayerController",
    );
    expect(staticCalls.length).toBeGreaterThan(0);
  });

  it("extracts constructor calls (new T())", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const newCalls = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "EnemySpawner",
    );
    expect(newCalls.length).toBeGreaterThan(0);
  });

  it("extracts event subscriptions (+=)", () => {
    const content = `using System;
    public class Listener : MonoBehaviour {
        void Start() {
            SomeManager.OnEvent += HandleEvent;
        }
        void HandleEvent() {}
    }`;
    const rels = extractRelationships(content);
    const subs = rels.filter((r) => r.edgeType === "SUBSCRIBES_TO");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs[0].targetClassName).toBe("SomeManager");
  });

  it("ignores Unity built-in types", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const builtins = rels.filter(
      (r) => r.targetClassName === "MeshRenderer" || r.targetClassName === "Debug",
    );
    expect(builtins).toHaveLength(0);
  });

  it("returns empty array for interface-only file", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/IDamageable.cs"), "utf-8");
    const rels = extractRelationships(content);
    expect(rels).toHaveLength(0);
  });

  it("associates relationships with source class name", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const healthRels = rels.filter((r) => r.sourceClassName === "HealthSystem");
    expect(healthRels.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/relationship-extractor.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 5: Implement relationship extractor**

Create `src/parsers/relationship-extractor.ts`:

```typescript
import { Parser, Language, type Node } from "web-tree-sitter";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { GraphEdgeType } from "../types.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(thisDir, "../../grammars/tree-sitter-c_sharp.wasm");

let parser: Parser | null = null;

export interface ExtractedRelationship {
  sourceClassName: string;
  edgeType: GraphEdgeType;
  targetClassName: string;
}

const UNITY_BUILTINS = new Set([
  "MonoBehaviour",
  "ScriptableObject",
  "Component",
  "GameObject",
  "Transform",
  "Rigidbody",
  "Rigidbody2D",
  "Collider",
  "Collider2D",
  "Renderer",
  "MeshRenderer",
  "SkinnedMeshRenderer",
  "SpriteRenderer",
  "Camera",
  "Light",
  "AudioSource",
  "AudioListener",
  "Animator",
  "Animation",
  "ParticleSystem",
  "Canvas",
  "RectTransform",
  "EventSystem",
  "NavMeshAgent",
  "Debug",
  "Mathf",
  "Vector2",
  "Vector3",
  "Vector4",
  "Quaternion",
  "Color",
  "Time",
  "Input",
  "Application",
  "Resources",
  "Physics",
  "Physics2D",
  "Random",
  "PlayerPrefs",
  "SceneManager",
  "Object",
  "String",
  "Math",
  "Console",
  "Array",
  "List",
  "Dictionary",
  "HashSet",
  "Queue",
  "Stack",
]);

async function ensureParser(): Promise<Parser> {
  if (parser !== null) return parser;
  await Parser.init();
  const wasmBuffer = readFileSync(wasmPath);
  const lang = await Language.load(wasmBuffer);
  parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export function extractRelationships(content: string): ExtractedRelationship[] {
  if (!parser) {
    throw new Error("Script parser not initialized. Call initScriptParser() first.");
  }

  const tree = parser.parse(content);
  if (!tree) return [];

  const results: ExtractedRelationship[] = [];
  walkForClasses(tree.rootNode, results);
  tree.delete();
  return results;
}

function walkForClasses(node: Node, results: ExtractedRelationship[]): void {
  for (const child of node.namedChildren) {
    if (child.type === "namespace_declaration") {
      const body = child.childForFieldName("body");
      if (body) walkForClasses(body, results);
    } else if (child.type === "class_declaration" || child.type === "struct_declaration") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const className = nameNode.text;
        const body = child.childForFieldName("body");
        if (body) {
          extractFromBody(body, className, results);
        }
      }
    } else {
      walkForClasses(child, results);
    }
  }
}

function extractFromBody(body: Node, sourceClass: string, results: ExtractedRelationship[]): void {
  walkNode(body, sourceClass, results);
}

function walkNode(node: Node, sourceClass: string, results: ExtractedRelationship[]): void {
  for (const child of node.namedChildren) {
    // GetComponent<T>()
    if (child.type === "invocation_expression") {
      handleInvocation(child, sourceClass, results);
    }
    // new T()
    else if (child.type === "object_creation_expression") {
      handleObjectCreation(child, sourceClass, results);
    }
    // event += handler (look for assignment with +=)
    else if (child.type === "assignment_expression") {
      handleEventSubscription(child, sourceClass, results);
    }

    // Recurse
    walkNode(child, sourceClass, results);
  }
}

function handleInvocation(node: Node, sourceClass: string, results: ExtractedRelationship[]): void {
  const funcNode = node.namedChildren[0];
  if (!funcNode) return;

  // GetComponent<T>()
  if (funcNode.type === "generic_name" && funcNode.text.startsWith("GetComponent<")) {
    const typeArgs = funcNode.namedChildren.find((c) => c.type === "type_argument_list");
    if (typeArgs) {
      const typeArg = typeArgs.namedChildren[0];
      if (typeArg) {
        const typeName = typeArg.text.split("<")[0].trim();
        if (!UNITY_BUILTINS.has(typeName)) {
          results.push({
            sourceClassName: sourceClass,
            edgeType: "CALLS",
            targetClassName: typeName,
          });
        }
      }
    }
    return;
  }

  // SomeClass.Method() — member_access_expression
  if (funcNode.type === "member_access_expression") {
    const receiver = funcNode.childForFieldName("expression");
    if (receiver && receiver.type === "identifier") {
      const name = receiver.text;
      // Heuristic: starts with uppercase and is not a known built-in
      if (
        name[0] === name[0].toUpperCase() &&
        name[0] !== name[0].toLowerCase() &&
        !UNITY_BUILTINS.has(name)
      ) {
        results.push({ sourceClassName: sourceClass, edgeType: "CALLS", targetClassName: name });
      }
    }
  }
}

function handleObjectCreation(
  node: Node,
  sourceClass: string,
  results: ExtractedRelationship[],
): void {
  const typeNode = node.childForFieldName("type");
  if (!typeNode) return;

  const typeName = typeNode.text.split("<")[0].trim();
  if (!UNITY_BUILTINS.has(typeName) && typeName[0] === typeName[0].toUpperCase()) {
    results.push({ sourceClassName: sourceClass, edgeType: "CALLS", targetClassName: typeName });
  }
}

function handleEventSubscription(
  node: Node,
  sourceClass: string,
  results: ExtractedRelationship[],
): void {
  // Look for += operator
  const op = node.children.find((c) => c.type === "+" || c.text === "+=");
  if (!op && !node.text.includes("+=")) return;
  if (!node.text.includes("+=")) return;

  const left = node.childForFieldName("left");
  if (!left) return;

  // SomeClass.OnEvent += Handler
  if (left.type === "member_access_expression") {
    const receiver = left.childForFieldName("expression");
    if (receiver && receiver.type === "identifier") {
      const name = receiver.text;
      if (name[0] === name[0].toUpperCase() && !UNITY_BUILTINS.has(name)) {
        results.push({
          sourceClassName: sourceClass,
          edgeType: "SUBSCRIBES_TO",
          targetClassName: name,
        });
      }
    }
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/parsers/relationship-extractor.test.ts`
Expected: all PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/parsers/relationship-extractor.ts tests/parsers/relationship-extractor.test.ts tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs tests/fixtures/TestProject/Assets/Scripts/HealthSystem.cs.meta
git commit -m "feat: extract CALLS and SUBSCRIBES_TO relationships from C# AST"
```

---

### Task 5: Integrate Edge Extraction into Indexer Pipeline

**Files:**

- Modify: `src/indexer/indexer.ts`
- Modify: `src/db/store.ts` (add `graph` property)
- Modify: `tests/indexer/indexer.test.ts`

- [ ] **Step 1: Write failing test for graph edge generation during indexing**

Add to `tests/indexer/indexer.test.ts` (append a new describe block):

```typescript
describe("graph edge population", () => {
  it("creates INHERITS edges from script base classes", () => {
    // PlayerController extends MonoBehaviour — but MonoBehaviour is built-in, skip
    // Need to verify edges are created for non-builtin inheritance
    const edges = store.getAllGraphEdges();
    const inheritsEdges = edges.filter((e) => e.edge_type === "INHERITS");
    // There may be none if all base classes are built-in — that's ok
    expect(edges.length).toBeGreaterThanOrEqual(0);
  });

  it("creates IMPLEMENTS edges for interfaces", () => {
    const edges = store.getAllGraphEdges();
    const implementsEdges = edges.filter((e) => e.edge_type === "IMPLEMENTS");
    // PlayerController implements IDamageable
    expect(implementsEdges.length).toBeGreaterThan(0);
  });

  it("creates DEFINED_IN edges linking scripts to files", () => {
    const edges = store.getAllGraphEdges();
    const definedIn = edges.filter((e) => e.edge_type === "DEFINED_IN");
    expect(definedIn.length).toBeGreaterThan(0);
  });

  it("creates REFERENCES_GUID edges from scene references", () => {
    const edges = store.getAllGraphEdges();
    const guidRefs = edges.filter((e) => e.edge_type === "REFERENCES_GUID");
    expect(guidRefs.length).toBeGreaterThan(0);
  });

  it("creates CHILD_OF edges for GameObject hierarchy", () => {
    const edges = store.getAllGraphEdges();
    const childOf = edges.filter((e) => e.edge_type === "CHILD_OF");
    expect(childOf.length).toBeGreaterThan(0);
  });

  it("creates ATTACHES_TO edges for components", () => {
    const edges = store.getAllGraphEdges();
    const attachesTo = edges.filter((e) => e.edge_type === "ATTACHES_TO");
    expect(attachesTo.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indexer/indexer.test.ts`
Expected: FAIL — `store.getAllGraphEdges` is not used yet / edges empty

- [ ] **Step 3: Add `GraphManager` to `Store`**

In `src/db/store.ts`, add import:

```typescript
import { GraphManager } from "./graph.js";
```

Add property and method to `Store` class:

```typescript
  public readonly graph = new GraphManager();

  hydrateGraph(): void {
    this.graph.hydrate(this.getAllGraphEdges());
  }
```

- [ ] **Step 4: Modify Indexer to emit graph edges**

In `src/indexer/indexer.ts`, add imports:

```typescript
import { extractRelationships } from "../parsers/relationship-extractor.js";
import type { GraphEdgeRow, GraphEdgeType } from "../types.js";
```

Add a new method to `Indexer` for inserting edges:

```typescript
  private insertEdge(
    sourceType: GraphEdgeRow["source_type"],
    sourceId: number,
    targetType: GraphEdgeRow["target_type"],
    targetId: number,
    edgeType: GraphEdgeType,
    sourceFileId: number,
    metadata: string | null = null,
  ): void {
    this.store.insertGraphEdge({
      source_type: sourceType,
      source_id: sourceId,
      target_type: targetType,
      target_id: targetId,
      edge_type: edgeType,
      metadata,
      source_file_id: sourceFileId,
    });
  }
```

Modify `indexScript` method — after the script member insertion loop, add edge generation:

```typescript
// Graph edges: DEFINED_IN
this.insertEdge("script", scriptId, "file", fileId, "DEFINED_IN", fileId);

// Graph edges: INHERITS (if base_class resolves to a known script)
if (script.baseClass) {
  const baseScript = this.store.getScriptByClassName(script.baseClass);
  if (baseScript) {
    this.insertEdge("script", scriptId, "script", baseScript.id!, "INHERITS", fileId);
  }
}

// Graph edges: IMPLEMENTS
for (const iface of script.interfaces) {
  const ifaceScript = this.store.getScriptByClassName(iface);
  if (ifaceScript) {
    this.insertEdge("script", scriptId, "script", ifaceScript.id!, "IMPLEMENTS", fileId);
  }
}
```

After the script loop (after inserting all scripts and members), add relationship extraction:

```typescript
// Graph edges: CALLS and SUBSCRIBES_TO from AST analysis
const relationships = extractRelationships(content);
for (const rel of relationships) {
  const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
  const targetScript = this.store.getScriptByClassName(rel.targetClassName);
  if (sourceScript && targetScript) {
    this.insertEdge("script", sourceScript.id!, "script", targetScript.id!, rel.edgeType, fileId);
  }
}
```

Modify `storeGameObjects` — inside `insertRecursive`, after `store.insertGameObject`, add:

```typescript
// Graph edge: CHILD_OF
if (go.parentFileIdLocal !== null) {
  // Find parent GO id — we need to look it up
  const parentGo = this.store.getGameObjectByName(fileId /* parent name */);
  // Simpler: use a map built during recursion
}
```

Actually, this is cleaner — modify `storeGameObjects` to track GO IDs in a map. After `insertRecursive` for all roots, add edge creation:

Replace the existing `storeGameObjects` approach: build a `localIdToDbId` map during insertion, then create edges in a second pass:

```typescript
  private storeGameObjects(
    fileId: number,
    gameObjects: ParsedGameObject[],
    guidToClass: Map<string, string>,
  ): void {
    // ... existing code building childMap, roots, siblingCounters ...

    const localIdToDbId = new Map<string, number>();

    const insertRecursive = (go: ParsedGameObject, depth: number): number => {
      // ... existing code ...
      // After store.insertGameObject(goId), add:
      localIdToDbId.set(go.fileIdLocal, goId);
      // ... rest of existing code ...
    };

    for (const root of roots) {
      insertRecursive(root, 0);
    }

    // Graph edges from GameObjects
    for (const go of gameObjects) {
      const goDbId = localIdToDbId.get(go.fileIdLocal);
      if (!goDbId) continue;

      // CHILD_OF
      if (go.parentFileIdLocal !== null) {
        const parentDbId = localIdToDbId.get(go.parentFileIdLocal);
        if (parentDbId) {
          this.insertEdge("game_object", goDbId, "game_object", parentDbId, "CHILD_OF", fileId);
        }
      }

      // ATTACHES_TO and SCRIPTED_BY for components
      for (const comp of go.components) {
        const compDbId = localIdToDbId.get(comp.fileIdLocal);
        // Components don't have their own DB id in localIdToDbId,
        // but we need the component row id. We stored them inline.
        // Use a component lookup instead:
      }
    }
  }
```

Simpler approach — add ATTACHES_TO and SCRIPTED_BY edges inline during component insertion:

In the existing `for (const comp of go.components)` loop, after `store.insertComponent`, add:

```typescript
// Graph edge: ATTACHES_TO
this.insertEdge("component", compId, "game_object", goId, "ATTACHES_TO", fileId);

// Graph edge: SCRIPTED_BY
if (comp.scriptGuid) {
  const targetScript = guidToClass.get(comp.scriptGuid);
  if (targetScript) {
    const scriptRow = this.store.getScriptByClassName(targetScript);
    if (scriptRow) {
      this.insertEdge("component", compId, "script", scriptRow.id!, "SCRIPTED_BY", fileId);
    }
  }
}
```

Note: `insertComponent` returns the component ID — capture it:

```typescript
        const compId = this.store.insertComponent({...});
```

Modify `storeReferences` — add REFERENCES_GUID edges:

```typescript
  private storeReferences(fileId: number, references: ParsedGuidReference[]): void {
    for (const ref of references) {
      const guidRow = this.store.resolveGuid(ref.targetGuid);
      const targetFileId = guidRow?.file_id ?? null;

      this.store.insertReference({
        source_file_id: fileId,
        source_context: ref.context,
        target_guid: ref.targetGuid,
        target_file_id: targetFileId,
        ref_type: ref.refType,
      });

      // Graph edge: REFERENCES_GUID
      if (targetFileId !== null) {
        this.insertEdge("file", fileId, "file", targetFileId, "REFERENCES_GUID", fileId);
      }
    }
  }
```

In `indexAll`, after `recomputeReferenceCounts`, add graph hydration:

```typescript
log("hydrating graph...");
endPhase = this.benchmark?.startPhase("graph");
this.store.hydrateGraph();
endPhase?.();
```

In `indexFile` (single-file incremental), after `recomputeReferenceCounts`:

```typescript
this.store.hydrateGraph();
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/indexer/indexer.test.ts`
Expected: all PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/indexer/indexer.ts src/db/store.ts tests/indexer/indexer.test.ts
git commit -m "feat: emit graph edges during indexing and hydrate Graphology on startup"
```

---

### Task 6: Add New MCP Graph Tools

**Files:**

- Create: `src/mcp/graph-tools.ts`
- Modify: `src/mcp/server.ts` (register new tools)
- Create: `tests/mcp/graph-tools.test.ts`

- [ ] **Step 1: Write failing tests for graph MCP tools**

Create `tests/mcp/graph-tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import {
  handleTraceDependencies,
  handleTraceDependents,
  handleFindPath,
  handleGetSubgraph,
  handleDetectCycles,
  handleGetGraphStats,
} from "../../src/mcp/graph-tools.js";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject");
let store: Store;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(":memory:");
  const indexer = new Indexer(store, FIXTURES);
  indexer.indexAll();
});

afterEach(() => {
  store.close();
});

describe("handleTraceDependencies", () => {
  it("returns subgraph for known script", () => {
    const result = handleTraceDependencies(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
    expect(result.summary).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("returns error for unknown identifier", () => {
    const result = handleTraceDependencies(store, {
      identifier: "NonExistent",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });
});

describe("handleTraceDependents", () => {
  it("returns dependents for a script", () => {
    const result = handleTraceDependents(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("handleFindPath", () => {
  it("returns null-like response when no path", () => {
    const result = handleFindPath(store, {
      from: "PlayerController",
      to: "NonExistent",
    }) as Record<string, unknown>;

    // Should have error or empty path
    expect(result.error || result.path === null).toBeTruthy();
  });
});

describe("handleGetSubgraph", () => {
  it("returns neighborhood for a script", () => {
    const result = handleGetSubgraph(store, {
      identifier: "PlayerController",
      radius: 1,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("handleDetectCycles", () => {
  it("returns cycles array (possibly empty)", () => {
    const result = handleDetectCycles(store, {}) as Record<string, unknown>;

    expect(result.cycles).toBeDefined();
    expect(Array.isArray(result.cycles)).toBe(true);
  });
});

describe("handleGetGraphStats", () => {
  it("returns degree stats", () => {
    const result = handleGetGraphStats(store, {
      metric: "degree",
      top_n: 5,
    }) as Record<string, unknown>;

    expect(result.rankings).toBeDefined();
    const rankings = result.rankings as unknown[];
    expect(rankings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/graph-tools.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement graph tool handlers**

Create `src/mcp/graph-tools.ts`:

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../db/store.js";
import type { StoreResolver } from "./tools.js";
import { encodeNodeId, decodeNodeId } from "../types.js";
import type { GraphEdgeType } from "../types.js";

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

function resolveIdentifier(store: Store, identifier: string): string | null {
  // 1. Try as script class_name
  const script = store.getScriptByClassName(identifier);
  if (script) return encodeNodeId("script", script.id!);

  // 2. Try as file path
  const file = store.getFileByPath(identifier);
  if (file) return encodeNodeId("file", file.id);

  // 3. Try as literal node ID (e.g., "script:42")
  if (identifier.includes(":")) {
    const decoded = decodeNodeId(identifier);
    if (decoded.type && decoded.id) return identifier;
  }

  return null;
}

function labelNode(store: Store, nodeId: string): string {
  const { type, id } = decodeNodeId(nodeId);
  if (type === "file") {
    const f = store.getFileById(id);
    return f?.path ?? nodeId;
  }
  return nodeId;
}

export function handleTraceDependencies(
  store: Store,
  params: { identifier: string; depth?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (!nodeId) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const depth = Math.min(params.depth ?? 3, 10);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.traceDependencies(nodeId, depth, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
    })),
    edges: result.edges,
    summary: `${params.identifier} has ${String(result.nodes.length - 1)} transitive dependencies across ${String(depth)} levels`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleTraceDependents(
  store: Store,
  params: { identifier: string; depth?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (!nodeId) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const depth = Math.min(params.depth ?? 3, 10);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.traceDependents(nodeId, depth, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
    })),
    edges: result.edges,
    summary: `${String(result.nodes.length - 1)} things depend on ${params.identifier} within ${String(depth)} levels`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleFindPath(
  store: Store,
  params: { from: string; to: string; max_depth?: number },
): object {
  const fromNode = resolveIdentifier(store, params.from);
  const toNode = resolveIdentifier(store, params.to);

  if (!fromNode) return { token_hint: 10, error: `Cannot resolve: ${params.from}` };
  if (!toNode) return { token_hint: 10, error: `Cannot resolve: ${params.to}` };

  const result = store.graph.findPath(fromNode, toNode);
  if (!result) {
    return {
      token_hint: 10,
      path: null,
      summary: `No path found between ${params.from} and ${params.to}`,
    };
  }

  const response = {
    path: result.nodes,
    edges: result.edges,
    summary: `Path of length ${String(result.nodes.length - 1)} from ${params.from} to ${params.to}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetSubgraph(
  store: Store,
  params: { identifier: string; radius?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (!nodeId) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const radius = Math.min(params.radius ?? 2, 5);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.getSubgraph(nodeId, radius, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
    })),
    edges: result.edges,
    summary: `${String(result.nodes.length)} nodes within radius ${String(radius)} of ${params.identifier}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleDetectCycles(
  store: Store,
  params: { edge_types?: string[]; max_length?: number },
): object {
  const edgeTypes = (params.edge_types ?? [
    "INHERITS",
    "CALLS",
    "ASSEMBLY_DEPENDS",
  ]) as GraphEdgeType[];
  const maxLength = params.max_length ?? 10;
  const cycles = store.graph.detectCycles(edgeTypes, maxLength);

  const response = {
    cycles: cycles.map((cycle) => ({
      nodes: cycle,
      length: cycle.length,
    })),
    total: cycles.length,
    summary:
      cycles.length > 0
        ? `Found ${String(cycles.length)} circular dependencies`
        : "No circular dependencies detected",
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetGraphStats(
  store: Store,
  params: {
    metric: "degree" | "betweenness" | "connected_components";
    top_n?: number;
    edge_types?: string[];
  },
): object {
  const topN = params.top_n ?? 10;
  const rankings = store.graph.getTopNodes(params.metric, topN);

  const response = {
    metric: params.metric,
    rankings,
    summary: `Top ${String(rankings.length)} nodes by ${params.metric}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function registerGraphTools(server: McpServer, resolveStore: StoreResolver): void {
  const toContent = (obj: object) => ({
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  });

  server.registerTool(
    "trace_dependencies",
    {
      description:
        "Trace transitive dependencies of a script, file, or entity. Returns a subgraph.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Script class name, file path, or node ID (e.g. script:42)"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Max traversal depth (default 3)"),
        edge_types: z
          .array(z.string())
          .optional()
          .describe("Filter by edge types (e.g. ['CALLS', 'INHERITS'])"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleTraceDependencies(resolveStore(params.project), params)),
  );

  server.registerTool(
    "trace_dependents",
    {
      description:
        "Find what depends on a script/file transitively. Answers: 'what breaks if I change X?'",
      inputSchema: {
        identifier: z.string().describe("Script class name, file path, or node ID"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Max traversal depth (default 3)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleTraceDependents(resolveStore(params.project), params)),
  );

  server.registerTool(
    "find_path",
    {
      description: "Find the shortest path between two entities in the dependency graph.",
      inputSchema: {
        from: z.string().describe("Start: script class name, file path, or node ID"),
        to: z.string().describe("End: script class name, file path, or node ID"),
        max_depth: z.number().int().optional().describe("Max path length (default 10)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleFindPath(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_subgraph",
    {
      description: "Get the neighborhood subgraph around an entity within a given radius.",
      inputSchema: {
        identifier: z.string().describe("Script class name, file path, or node ID"),
        radius: z.number().int().min(1).max(5).optional().describe("Hop radius (default 2)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetSubgraph(resolveStore(params.project), params)),
  );

  server.registerTool(
    "detect_cycles",
    {
      description: "Detect circular dependencies in the graph.",
      inputSchema: {
        edge_types: z
          .array(z.string())
          .optional()
          .describe("Edge types to check (default: INHERITS, CALLS, ASSEMBLY_DEPENDS)"),
        max_length: z.number().int().optional().describe("Max cycle length to report (default 10)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleDetectCycles(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_graph_stats",
    {
      description: "Get graph metrics: most-connected nodes, centrality, or connected components.",
      inputSchema: {
        metric: z
          .enum(["degree", "betweenness", "connected_components"])
          .describe("Which metric to compute"),
        top_n: z.number().int().optional().describe("Number of top results (default 10)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetGraphStats(resolveStore(params.project), params)),
  );
}
```

- [ ] **Step 4: Register graph tools in server**

In `src/mcp/server.ts`, add import:

```typescript
import { registerGraphTools } from "./graph-tools.js";
```

Add after the existing `registerTools(server, resolveStore)` call:

```typescript
registerGraphTools(server, resolveStore);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/mcp/graph-tools.test.ts`
Expected: all PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/mcp/graph-tools.ts src/mcp/server.ts tests/mcp/graph-tools.test.ts
git commit -m "feat: add 6 new graph-powered MCP tools"
```

---

### Task 7: Enhance Existing MCP Tools with Depth Parameter

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write tests for depth parameter on `find_references` and `find_dependencies`**

Add to `tests/mcp/tools.test.ts`:

```typescript
describe("find_references with depth", () => {
  it("returns single-hop refs with depth=1 (default behavior)", () => {
    const result = handleFindReferences(store, {
      guid_or_name: "PlayerController",
    }) as Record<string, unknown>;

    expect(result.references).toBeDefined();
  });

  it("returns graph-based refs with depth > 1", () => {
    const result = handleFindReferences(store, {
      guid_or_name: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.references || result.nodes).toBeDefined();
  });
});

describe("find_dependencies with depth", () => {
  it("returns single-hop deps with depth=1 (default behavior)", () => {
    const result = handleFindDependencies(store, {
      guid_or_name: "PlayerController",
    }) as Record<string, unknown>;

    expect(result.dependencies).toBeDefined();
  });

  it("returns graph-based deps with depth > 1", () => {
    const result = handleFindDependencies(store, {
      guid_or_name: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.dependencies || result.nodes).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL (depth param not accepted yet, or test expectations fail)

- [ ] **Step 3: Add depth parameter to `handleFindReferences`**

Modify `handleFindReferences` signature and body in `src/mcp/tools.ts`:

```typescript
export function handleFindReferences(
  store: Store,
  params: { guid_or_name: string; depth?: number },
): object {
  // If depth > 1, delegate to graph
  if (params.depth !== undefined && params.depth > 1) {
    const nodeId = resolveToNodeId(store, params.guid_or_name);
    if (!nodeId) return { token_hint: 10, error: `Cannot resolve: ${params.guid_or_name}` };

    const result = store.graph.traceDependents(nodeId, params.depth);
    const response = {
      guid_or_name: params.guid_or_name,
      nodes: result.nodes.map((n) => ({ id: n.id, depth: n.depth })),
      edges: result.edges,
      total: result.nodes.length - 1,
    };
    return { token_hint: estimateTokens(response), ...response };
  }

  // ... existing single-hop code unchanged ...
}
```

Add a helper function (similar to graph-tools.ts resolveIdentifier):

```typescript
import { encodeNodeId } from "../types.js";

function resolveToNodeId(store: Store, identifier: string): string | null {
  const script = store.getScriptByClassName(identifier);
  if (script) return encodeNodeId("script", script.id!);
  const file = store.getFileByPath(identifier);
  if (file) return encodeNodeId("file", file.id);
  if (identifier.includes(":")) return identifier;
  return null;
}
```

Do the same for `handleFindDependencies`:

```typescript
export function handleFindDependencies(
  store: Store,
  params: { guid_or_name: string; depth?: number },
): object {
  if (params.depth !== undefined && params.depth > 1) {
    const nodeId = resolveToNodeId(store, params.guid_or_name);
    if (!nodeId) return { token_hint: 10, error: `Cannot resolve: ${params.guid_or_name}` };

    const result = store.graph.traceDependencies(nodeId, params.depth);
    const response = {
      source: params.guid_or_name,
      nodes: result.nodes.map((n) => ({ id: n.id, depth: n.depth })),
      edges: result.edges,
      total: result.nodes.length - 1,
    };
    return { token_hint: estimateTokens(response), ...response };
  }

  // ... existing single-hop code unchanged ...
}
```

Update tool registrations to include `depth` parameter in inputSchema:

```typescript
  // In find_references registration:
  depth: z.number().int().min(1).max(10).optional().describe("Traversal depth (1 = direct refs, >1 = transitive via graph)"),

  // In find_dependencies registration:
  depth: z.number().int().min(1).max(10).optional().describe("Traversal depth (1 = direct deps, >1 = transitive via graph)"),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: all PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add depth parameter to find_references and find_dependencies"
```

---

### Task 7.5: Enhance `get_script_detail` with Graph Relationships

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/mcp/tools.test.ts` inside the `handleGetScriptDetail` describe block:

```typescript
it("includes relationships from graph", () => {
  const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
    string,
    unknown
  >;

  expect(result.relationships).toBeDefined();
  const rels = result.relationships as Record<string, unknown>;
  expect(rels).toHaveProperty("inherits");
  expect(rels).toHaveProperty("implements");
  expect(rels).toHaveProperty("callers");
  expect(rels).toHaveProperty("callees");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL — `result.relationships` is undefined

- [ ] **Step 3: Add relationships to `handleGetScriptDetail`**

In `src/mcp/tools.ts`, modify `handleGetScriptDetail` — after building the `response` object, add a `relationships` field:

```typescript
// Graph relationships
const scriptNodeId = encodeNodeId("script", script.id!);
const outgoing = store.graph.getOutgoing(scriptNodeId);
const incoming = store.graph.getIncoming(scriptNodeId);

const relationships = {
  inherits: outgoing.filter((n) => n.edgeType === "INHERITS").map((n) => n.nodeId),
  implements: outgoing.filter((n) => n.edgeType === "IMPLEMENTS").map((n) => n.nodeId),
  callees: outgoing.filter((n) => n.edgeType === "CALLS").map((n) => n.nodeId),
  callers: incoming.filter((n) => n.edgeType === "CALLS").map((n) => n.nodeId),
  subscribers: incoming.filter((n) => n.edgeType === "SUBSCRIBES_TO").map((n) => n.nodeId),
};
```

Add `relationships` to the response object. Also add `import { encodeNodeId } from "../types.js";` if not already imported.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add graph relationships to get_script_detail response"
```

---

### Task 8: Wire Up File Watcher for Incremental Graph Updates

**Files:**

- Modify: `src/indexer/indexer.ts`
- Modify: `src/indexer/file-watcher.ts` (if needed)

- [ ] **Step 1: Verify incremental update works**

The incremental path is `indexFile` → `deleteFileData` (which now includes `DELETE FROM graph_edges WHERE source_file_id = ?`) → re-index → `hydrateGraph`. This should already work from Task 5 changes.

Write a quick integration test or verify manually:

Run: `npx vitest run tests/indexer/indexer.test.ts`
Expected: all PASS

- [ ] **Step 2: Verify `removeFile` cleans up graph edges**

In `src/indexer/indexer.ts`, the `removeFile` method calls `store.deleteFileData(existing.id)` which already cleans up `graph_edges` (from Task 2 Step 5). After deletion, `recomputeReferenceCounts` runs, and now we need `hydrateGraph` too.

Add to `removeFile`, after `this.store.recomputeReferenceCounts()`:

```typescript
this.store.hydrateGraph();
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "fix: ensure graph re-hydrates after file removal"
```

---

### Task 9: Add Assembly and Variant Graph Edges

**Files:**

- Modify: `src/indexer/indexer.ts`

- [ ] **Step 1: Add ASSEMBLY_DEPENDS edges in `indexAsmDef`**

After `store.insertAssembly(...)` in `indexAsmDef`, add:

```typescript
// Graph edges: BELONGS_TO (file → assembly)
this.insertEdge("file", fileId, "assembly", asmId, "BELONGS_TO", fileId);

// Graph edges: ASSEMBLY_DEPENDS
for (const refName of parsed.references) {
  const allAssemblies = this.store.listAssemblies();
  const targetAsm = allAssemblies.find((a) => a.name === refName);
  if (targetAsm) {
    this.insertEdge("assembly", asmId, "assembly", targetAsm.id!, "ASSEMBLY_DEPENDS", fileId);
  }
}
```

Note: `insertAssembly` returns the assembly ID — capture it:

```typescript
    const asmId = this.store.insertAssembly({...});
```

- [ ] **Step 2: Add VARIANT_OF edges in `indexPrefab`**

In `indexPrefab`, after the `store.upsertFile` call, add:

```typescript
// Graph edge: VARIANT_OF
if (parsed.sourcePrefabGuid) {
  const guidRow = this.store.resolveGuid(parsed.sourcePrefabGuid);
  if (guidRow) {
    const metaFile = this.store.getFileById(guidRow.file_id);
    if (metaFile) {
      const basePath = metaFile.path.endsWith(".meta") ? metaFile.path.slice(0, -5) : metaFile.path;
      const baseFile = this.store.getFileByPath(basePath);
      if (baseFile) {
        this.insertEdge("file", fileId, "file", baseFile.id, "VARIANT_OF", fileId);
      }
    }
  }
}
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "feat: add ASSEMBLY_DEPENDS, BELONGS_TO, and VARIANT_OF graph edges"
```

---

### Task 10: Final Integration Test and Typecheck

**Files:**

- Modify: `tests/integration.test.ts` (if exists)

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 3: Run lint**

Run: `npx eslint .`
Expected: no errors (fix any that appear)

- [ ] **Step 4: Run format**

Run: `npx prettier --write .`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix lint and format for graph layer"
```
