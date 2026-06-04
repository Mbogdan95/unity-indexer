# Performance Optimization Design

Systematic optimization of unity-indexer across three axes: processing speed, storage efficiency, and token economy.

**Approach**: Fix all identified issues methodically without over-engineering. No new dependencies. Keep JSON (debuggable) over binary formats. Add benchmarking to prove gains.

**Breaking changes**: Full freedom — DB schema, MCP response formats, parser internals all modifiable.

**Target scale**: Indie to AAA (hundreds to 10K+ scripts, hundreds of scenes).

---

## Section 1: Store Layer Optimizations

### 1a. Prepared Statement Cache

Every store method currently calls `db.prepare(sql)` fresh each invocation. With thousands of entities per indexing run, this is thousands of redundant prepare calls.

Add lazy-initialized statement cache to `UnityStore`:

```typescript
private stmts = new Map<string, Statement>();

private prepare(sql: string): Statement {
  let stmt = this.stmts.get(sql);
  if (!stmt) {
    stmt = this.db.prepare(sql);
    this.stmts.set(sql, stmt);
  }
  return stmt;
}
```

All store methods switch from `this.db.prepare(sql).run(...)` to `this.prepare(sql).run(...)`.

### 1b. Eliminate N+1 in buildGuidToClassMap()

Current implementation: 4 sequential queries per script (script → file → meta file → guid). For 1000 scripts = 4000 queries.

Replace with single JOIN query in store:

```sql
SELECT s.class_name, g.guid
FROM scripts s
JOIN files f ON s.file_id = f.id
JOIN files mf ON mf.path = f.path || '.meta'
JOIN guids g ON g.file_id = mf.id
WHERE s.is_monobehaviour = 1
```

Returns `Map<guid, className>` directly. One query replaces thousands.

### 1c. Add Missing Indexes

```sql
CREATE INDEX idx_scripts_file_id ON scripts(file_id);
CREATE INDEX idx_guids_file_id ON guids(file_id);
CREATE INDEX idx_components_script_guid ON components(script_guid);
```

Cover foreign key lookups currently hitting full table scans.

### 1d. Fix listScripts().find() in updateProjectSummary()

Current: calls `listScripts()` (full table), then `.find()` per hot ref in JS.

Replace with direct query: `SELECT ... FROM scripts WHERE file_id = ?` or batch `WHERE file_id IN (...)`.

---

## Section 2: Indexer Pipeline Optimizations

### 2a. Eliminate Redundant Hash Computation

Content hash (`SHA256`) computed in `indexFileInternal()`, then recomputed in each type-specific indexer. 6 hash calls per file.

Compute once in `indexFileInternal()`, pass hash + content to type-specific methods via parameter.

### 2b. Single-Pass Hierarchy Computation

Current: two separate tree walks — one for `depthMap`, one for `subtreeDepthMap`. Plus separate sibling index assignment.

Replace with single recursive DFS that computes depth, sibling index, child count, and subtree summary in one pass.

### 2c. Batch INSERT via Cached Prepared Statements

Individual `INSERT` per member/component inside transactions. Combined with 1a (prepared statement cache), eliminates prepare overhead per row. Statement cached once, reused for all rows in batch.

Multi-row VALUES clause considered and rejected — variable column count makes SQL generation messy, and better-sqlite3 prepared statements are already fast within transactions.

### 2d. Deduplicate buildGuidToClassMap() Calls

Built at indexing start, but fallback rebuilds exist in `indexScene`/`indexPrefab`. Redundant safety net.

Build once in `indexAll()`, store on instance, pass explicitly. Remove fallback rebuilds. For single-file re-index, build lazily once.

### 2e. Transform/GameObject Map Consolidation

Scene parser builds two separate maps (`transformToGo`, `goToTransform`) from same data.

Consolidate to single map. Only one direction needed for parent resolution.

---

## Section 3: MCP Response Optimizations

### 3a. Compact Response Formatting

Reduce token cost of MCP responses:

- **Drop default-value fields**: `active: true` (omit when true), `layer: 0` (omit when 0), `tag: "Untagged"` (omit when Untagged)
- **Shorten keys**: `component_summary` → `components`, `importance_score` → `importance`, `children_count` → `children`
- **Omit zero/empty values**: empty arrays, null fields, zero counts

### 3b. Dynamic Token Hints

Current: static multipliers (`roots.length * 10`). No correlation to actual response size.

Compute after building response:

```typescript
function estimateTokens(obj: unknown): number {
  const json = JSON.stringify(obj);
  return Math.ceil(json.length / 4);
}
```

Accurate hints let LLMs make better fetch decisions.

### 3c. Eliminate Redundant JSON Round-Trips

Indexer does `JSON.stringify()` to store → tools.ts does `JSON.parse()` to include in response → MCP SDK does `JSON.stringify()` on whole response.

For fields stored as JSON strings and returned as-is: keep as raw JSON strings, embed directly without parse-reserialize cycle.

For fields needing transformation: parse is unavoidable, but cache parsed result if accessed multiple times in same request.

### 3d. Progressive Disclosure in Responses

Full fidelity in storage (all serialized fields kept). MCP responses serve what's asked:

- List operations: identifying info only (name, type, importance)
- Detail operations: full payload
- No data loss — store everything, serve progressively

---

## Section 4: Benchmarking Harness

### 4a. Indexing Benchmarks

Metrics:

- Total indexing time (wall clock)
- Per-phase breakdown: meta, scripts, scenes/prefabs, summaries, reference counting
- Files/second throughput
- Peak memory usage (`process.memoryUsage()`)
- Database file size after indexing

CLI flag `--benchmark` enables structured timing output.

### 4b. Query Benchmarks

Per MCP tool:

- Response time (ms)
- Response size (bytes)
- Actual token estimate vs hint accuracy

Enabled via env var `UNITY_INDEXER_BENCHMARK=1`.

### 4c. Test Fixture Scaling

Current TestProject is too small for meaningful benchmarks. Add synthetic project generator:

- Configurable: N scripts, M scenes, K GameObjects per scene
- Produces valid .cs, .unity, .prefab, .meta, .asmdef files
- Deterministic (seeded) for reproducible benchmarks

Default sizes:

- Small: 100 scripts, 5 scenes
- Medium: 1000 scripts, 50 scenes
- Large: 5000 scripts, 200 scenes

### 4d. Before/After Comparison

Benchmark output as JSON:

```json
{
  "indexing_ms": 1234,
  "db_size_bytes": 567890,
  "peak_memory_bytes": 12345678,
  "phases": { "meta": 50, "scripts": 400, "scenes": 600 },
  "queries": { "get_scene_hierarchy": { "avg_ms": 5, "avg_bytes": 1200 } }
}
```

Run before branch, run after, diff for hard numbers.

---

## Implementation Order

1. **Benchmarking harness first** (Section 4) — measure baseline before changing anything
2. **Store layer** (Section 1) — highest impact, foundational for other changes
3. **Indexer pipeline** (Section 2) — builds on store improvements
4. **MCP responses** (Section 3) — polish layer, depends on stable store/indexer

## Out of Scope

- Streaming YAML parser (complexity not justified by gains)
- Binary serialization formats (MessagePack etc. — debugging cost too high)
- Worker thread parallelism (single-threaded is sufficient for target scale)
- New dependencies (all optimizations use existing libraries)
