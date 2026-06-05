# Graph Layer for Unity Indexer

## Overview

Add a graph layer to the existing SQLite-backed Unity indexer. SQLite remains the source of truth for entity storage and flat queries. A new `graph_edges` table persists relationships, and Graphology (in-memory directed graph) provides fast multi-hop traversal, pathfinding, and graph algorithms.

**Goals:**

- Multi-hop transitive dependency/dependent traversal
- Richer relationship types beyond GUID references (inheritance, method calls, hierarchy, events)
- Smarter MCP responses — return connected subgraphs instead of flat lists
- Scale to 10K+ scripts with efficient incremental updates

## Graph Data Model

### Node Types

| Node Type     | Source Table   | Key Properties                    |
| ------------- | -------------- | --------------------------------- |
| `file`        | `files`        | path, type, importance            |
| `script`      | `scripts`      | class_name, namespace, base_class |
| `game_object` | `game_objects` | name, scene/prefab path           |
| `component`   | `components`   | type_name, script_guid            |
| `assembly`    | `assemblies`   | name                              |

Nodes are identified by type-prefixed SQLite row IDs: `script:42`, `file:17`, etc.

### Edge Types

| Edge Type          | From → To               | Source                                   |
| ------------------ | ----------------------- | ---------------------------------------- |
| `INHERITS`         | Script → Script         | tree-sitter: base_class                  |
| `IMPLEMENTS`       | Script → Script         | tree-sitter: interfaces                  |
| `ATTACHES_TO`      | Component → GameObject  | components.game_object_id                |
| `SCRIPTED_BY`      | Component → Script      | components.script_guid → guids → scripts |
| `CHILD_OF`         | GameObject → GameObject | game_objects parent hierarchy            |
| `DEFINED_IN`       | Script → File           | scripts.file_id                          |
| `REFERENCES_GUID`  | File → File             | existing references table                |
| `VARIANT_OF`       | File → File             | prefab variant → base prefab             |
| `BELONGS_TO`       | File → Assembly         | asmdef membership                        |
| `CALLS`            | Script → Script         | tree-sitter: method invocations (new)    |
| `SUBSCRIBES_TO`    | Script → Script         | tree-sitter: event subscriptions (new)   |
| `ASSEMBLY_DEPENDS` | Assembly → Assembly     | asmdef references                        |

## Architecture

### Integration with Indexer Pipeline

```
Existing phases                    Graph integration
──────────────────                 ──────────────────
1. Index .meta files
2. Index scripts (tree-sitter)  →  Extract INHERITS, IMPLEMENTS, CALLS, SUBSCRIBES_TO
3. Index assets                 →  Extract REFERENCES_GUID
4. Build GUID→Class map
5. Index scenes/prefabs         →  Extract CHILD_OF, ATTACHES_TO, SCRIPTED_BY, VARIANT_OF
6. Compute reference counts
                                7. Hydrate graph (new phase)
                                   - Load all edges from graph_edges into Graphology
                                   - Compute derived metrics
```

### Persistence: `graph_edges` Table

```sql
CREATE TABLE graph_edges (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  edge_type TEXT NOT NULL,
  metadata TEXT,
  source_file_id INTEGER,
  UNIQUE(source_type, source_id, target_type, target_id, edge_type)
);
CREATE INDEX idx_edges_source ON graph_edges(source_type, source_id);
CREATE INDEX idx_edges_target ON graph_edges(target_type, target_id);
CREATE INDEX idx_edges_file ON graph_edges(source_file_id);
CREATE INDEX idx_edges_type ON graph_edges(edge_type);
```

- Edges written to SQLite during indexing (same transaction as entity data)
- `source_file_id` enables incremental updates: delete all edges from a changed file, re-insert
- `metadata` column stores optional JSON (e.g., call site line numbers)

### In-Memory Graph

- `Store` class gains a `graph: DirectedGraph` property (Graphology)
- Hydrated once after full index, patched incrementally on file changes
- Graph queries go through Store methods; MCP tools call Store as today
- At 10K scripts × ~20 edges/script = ~200K edges ≈ ~50MB memory

### Incremental Updates

On file change (via file watcher):

1. Re-index changed file (existing behavior)
2. `DELETE FROM graph_edges WHERE source_file_id = ?`
3. Insert new edges for that file
4. Patch Graphology: drop edges from that source, add new edges

## Method Call & Event Extraction

Extends `script-parser.ts` with `extractRelationships(tree, sourceCode)`.

### Extractable Patterns

1. **Static/explicit method calls** — `SomeClass.Method()` via `invocation_expression` → `member_access_expression`
2. **Constructor calls** — `new SomeClass()` → `CALLS` edge
3. **Event subscriptions** — `someEvent += Handler` via `assignment_expression` with `+=`
4. **GetComponent patterns** — `GetComponent<SomeScript>()` via generic type argument

### Out of Scope

- Instance calls on untyped variables (needs type inference)
- Reflection-based calls
- UnityEvent wiring (already captured as GUID references in serialized YAML)
- Calls through interfaces without visible concrete type

### Resolution

`extractRelationships` returns `Array<{edgeType, targetClassName}>`. Class name → script ID resolution happens during graph-build phase using `scripts` table lookups.

Expected coverage: ~70% of meaningful call edges without building a type system.

## New MCP Tools

### `trace_dependencies`

Multi-hop transitive dependencies from a node.

**Params:** `identifier` (class name, file path, or node ID — resolved in that order: exact script class_name match first, then file path match, then literal node ID), `depth` (default 3, max 10), `edge_types` (optional filter)

**Returns:** Subgraph of all transitive dependencies.

**Example:** "What does PlayerController depend on, 3 levels deep?"

### `trace_dependents`

Reverse traversal — what depends on X transitively.

**Params:** Same as `trace_dependencies` (same identifier resolution order).

**Example:** "What breaks if I delete HealthSystem.cs?"

### `find_path`

Shortest path between two nodes.

**Params:** `from`, `to` (class name, file path, or node ID), `max_depth` (default 10)

**Returns:** Ordered path with edge types.

**Example:** "How are AudioManager and SaveSystem connected?"

### `get_subgraph`

Connected neighborhood around a node.

**Params:** `identifier`, `radius` (default 2), `edge_types` (optional filter)

**Returns:** All nodes and edges within radius hops.

**Example:** "Show me everything related to InventoryItem within 2 hops"

### `detect_cycles`

Find circular dependencies.

**Params:** `edge_types` (optional, default `['INHERITS', 'CALLS', 'ASSEMBLY_DEPENDS']`), `max_length` (default 10)

**Returns:** List of cycles with node paths.

### `get_graph_stats`

Centrality, most-connected nodes, clustering info.

**Params:** `metric` (one of `degree`, `betweenness`, `connected_components`), `top_n` (default 10), `edge_types` (optional filter)

**Returns:** Ranked list of nodes by chosen metric.

## Enhanced Existing Tools

### `find_references`

Add `depth` parameter (default 1 = current behavior). When depth > 1, uses graph traversal instead of SQL JOIN.

### `find_dependencies`

Same `depth` parameter addition.

### `get_script_detail`

Add `relationships` field showing inheritance chain, callers, and callees from graph.

## Graph Response Format

All graph-returning tools use this structure:

```json
{
  "nodes": [
    { "id": "script:42", "type": "script", "label": "PlayerController", "depth": 0 },
    { "id": "script:17", "type": "script", "label": "HealthSystem", "depth": 1 }
  ],
  "edges": [{ "source": "script:42", "target": "script:17", "type": "CALLS" }],
  "summary": "PlayerController has 12 transitive dependencies across 3 levels"
}
```

- `depth` on nodes indicates distance from the query origin
- `summary` gives LLM quick context without parsing full node/edge lists
- Token-efficient: omit default values, no pretty-printing (consistent with existing approach)

## Dependencies

- `graphology` — directed graph data structure (~1.2M weekly downloads)
- `graphology-shortest-path` — pathfinding algorithms
- `graphology-traversal` — BFS/DFS traversal
- `graphology-metrics` — centrality, density
- `graphology-cycles` — cycle detection (if available, otherwise manual DFS)

All are peer packages in the Graphology ecosystem. TypeScript types included.
