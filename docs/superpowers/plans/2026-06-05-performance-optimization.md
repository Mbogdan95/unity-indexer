# Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximize unity-indexer performance across indexing speed, storage efficiency, and token economy.

**Architecture:** Bottom-up optimization — benchmark first, then fix store layer (prepared statements, N+1 elimination, missing indexes), indexer pipeline (redundant hash, single-pass hierarchy), and MCP responses (compact format, dynamic token hints, JSON round-trip elimination).

**Tech Stack:** TypeScript, better-sqlite3, vitest, Node.js performance APIs

---

## File Structure

**New files:**

- `src/benchmark.ts` — benchmark harness with timing + memory + DB size measurement
- `tests/benchmark/generate-fixture.ts` — synthetic Unity project generator
- `tests/benchmark/benchmark.test.ts` — benchmark tests (not run in CI, manual only)

**Modified files:**

- `src/db/store.ts` — prepared statement cache, new `getGuidToClassMap()` query, `getScriptByFileId()` query
- `src/db/schema.ts` — add missing indexes
- `src/indexer/indexer.ts` — pass content hash, single-pass hierarchy, deduplicate guid map builds
- `src/mcp/tools.ts` — compact responses, dynamic token hints, eliminate JSON round-trips
- `src/parsers/scene-parser.ts` — consolidate transform maps
- `src/index.ts` — add `--benchmark` flag
- `package.json` — add benchmark script
- `tests/db/store.test.ts` — tests for new store methods
- `tests/mcp/tools.test.ts` — update for new response shapes

---

### Task 1: Synthetic Fixture Generator

**Files:**

- Create: `tests/benchmark/generate-fixture.ts`

- [ ] **Step 1: Create the fixture generator**

```typescript
// tests/benchmark/generate-fixture.ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

interface GeneratorConfig {
  scripts: number;
  scenes: number;
  gameObjectsPerScene: number;
  prefabs: number;
  seed: number;
}

const PRESETS: Record<string, GeneratorConfig> = {
  small: { scripts: 100, scenes: 5, gameObjectsPerScene: 50, prefabs: 20, seed: 42 },
  medium: { scripts: 1000, scenes: 50, gameObjectsPerScene: 100, prefabs: 200, seed: 42 },
  large: { scripts: 5000, scenes: 200, gameObjectsPerScene: 200, prefabs: 1000, seed: 42 },
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateGuid(index: number): string {
  return createHash("md5")
    .update(`guid-${String(index)}`)
    .digest("hex");
}

function generateMetaFile(guid: string): string {
  return `fileFormatVersion: 2\nguid: ${guid}\n`;
}

function generateScript(index: number, rand: () => number): string {
  const className = `Class${String(index)}`;
  const isMonoBehaviour = rand() > 0.3;
  const baseClass = isMonoBehaviour ? " : MonoBehaviour" : "";
  const memberCount = Math.floor(rand() * 10) + 1;

  const members: string[] = [];
  for (let m = 0; m < memberCount; m++) {
    if (rand() > 0.5) {
      members.push(`    [SerializeField] private float field${String(m)};`);
    } else {
      const paramCount = Math.floor(rand() * 3);
      const params = Array.from({ length: paramCount }, (_, i) => `int p${String(i)}`).join(", ");
      members.push(`    public void Method${String(m)}(${params}) { }`);
    }
  }

  return `using UnityEngine;\n\npublic class ${className}${baseClass}\n{\n${members.join("\n")}\n}\n`;
}

function generateGameObject(
  goIndex: number,
  parentId: number | null,
  scriptGuids: string[],
  rand: () => number,
): string {
  const goFileId = 1000 + goIndex * 10;
  const transformFileId = goFileId + 1;
  const fatherId = parentId !== null ? parentId + 1 : 0;

  const lines: string[] = [];

  lines.push(`--- !u!1 &${String(goFileId)}`);
  lines.push("GameObject:");
  lines.push(`  m_Name: GameObject${String(goIndex)}`);
  lines.push("  m_IsActive: 1");
  lines.push("  m_Layer: 0");
  lines.push("  m_TagString: Untagged");
  lines.push("  m_Component:");
  lines.push(`  - component: {fileID: ${String(transformFileId)}}`);

  const hasScript = rand() > 0.5 && scriptGuids.length > 0;
  const mbFileId = goFileId + 2;
  if (hasScript) {
    lines.push(`  - component: {fileID: ${String(mbFileId)}}`);
  }

  lines.push(`--- !u!4 &${String(transformFileId)}`);
  lines.push("Transform:");
  lines.push(`  m_GameObject: {fileID: ${String(goFileId)}}`);
  lines.push(`  m_Father: {fileID: ${String(fatherId)}}`);
  lines.push("  m_LocalPosition: {x: 0, y: 0, z: 0}");
  lines.push("  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}");
  lines.push("  m_LocalScale: {x: 1, y: 1, z: 1}");

  if (hasScript) {
    const guid = scriptGuids[Math.floor(rand() * scriptGuids.length)];
    lines.push(`--- !u!114 &${String(mbFileId)}`);
    lines.push("MonoBehaviour:");
    lines.push(`  m_GameObject: {fileID: ${String(goFileId)}}`);
    lines.push(`  m_Script: {fileID: 11500000, guid: ${guid}, type: 3}`);
    lines.push("  m_Enabled: 1");
    lines.push(`  speed: ${String(Math.floor(rand() * 100))}`);
  }

  return lines.join("\n");
}

function generateScene(
  sceneIndex: number,
  goCount: number,
  scriptGuids: string[],
  rand: () => number,
): string {
  const header = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:";
  const gos: string[] = [header];

  for (let g = 0; g < goCount; g++) {
    const parentId = g > 0 && rand() > 0.3 ? 1000 + Math.floor(rand() * g) * 10 : null;
    gos.push(generateGameObject(sceneIndex * 10000 + g, parentId, scriptGuids, rand));
  }

  return gos.join("\n");
}

export function generateFixture(outDir: string, preset: string = "small"): GeneratorConfig {
  const config = PRESETS[preset];
  if (!config)
    throw new Error(`Unknown preset: ${preset}. Use: ${Object.keys(PRESETS).join(", ")}`);

  const rand = seededRandom(config.seed);
  const assetsDir = join(outDir, "Assets");
  const scriptsDir = join(assetsDir, "Scripts");
  const scenesDir = join(assetsDir, "Scenes");
  const prefabsDir = join(assetsDir, "Prefabs");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(scenesDir, { recursive: true });
  mkdirSync(prefabsDir, { recursive: true });

  writeFileSync(
    join(outDir, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.0f1\n",
    { recursive: true } as never,
  );
  mkdirSync(join(outDir, "ProjectSettings"), { recursive: true });
  writeFileSync(
    join(outDir, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.0f1\n",
  );

  const scriptGuids: string[] = [];
  for (let i = 0; i < config.scripts; i++) {
    const guid = generateGuid(i);
    scriptGuids.push(guid);
    const fileName = `Class${String(i)}.cs`;
    writeFileSync(join(scriptsDir, fileName), generateScript(i, rand));
    writeFileSync(join(scriptsDir, fileName + ".meta"), generateMetaFile(guid));
  }

  for (let i = 0; i < config.scenes; i++) {
    const fileName = `Scene${String(i)}.unity`;
    writeFileSync(
      join(scenesDir, fileName),
      generateScene(i, config.gameObjectsPerScene, scriptGuids, rand),
    );
    writeFileSync(
      join(scenesDir, fileName + ".meta"),
      generateMetaFile(generateGuid(config.scripts + i)),
    );
  }

  for (let i = 0; i < config.prefabs; i++) {
    const fileName = `Prefab${String(i)}.prefab`;
    const goCount = Math.floor(rand() * 5) + 1;
    writeFileSync(
      join(prefabsDir, fileName),
      generateScene(config.scenes + i, goCount, scriptGuids, rand),
    );
    writeFileSync(
      join(prefabsDir, fileName + ".meta"),
      generateMetaFile(generateGuid(config.scripts + config.scenes + i)),
    );
  }

  return config;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const preset = process.argv[2] ?? "small";
  const outDir = process.argv[3] ?? join(import.meta.dirname, "../fixtures/BenchmarkProject");
  console.log(`Generating ${preset} fixture in ${outDir}...`);
  const config = generateFixture(outDir, preset);
  console.log(
    `Done: ${String(config.scripts)} scripts, ${String(config.scenes)} scenes, ${String(config.prefabs)} prefabs`,
  );
}
```

- [ ] **Step 2: Verify generator runs**

Run: `npx tsx tests/benchmark/generate-fixture.ts small /tmp/test-fixture`
Expected: creates files in /tmp/test-fixture/Assets/Scripts/, Scenes/, Prefabs/

- [ ] **Step 3: Commit**

```bash
git add tests/benchmark/generate-fixture.ts
git commit -m "feat: add synthetic Unity project generator for benchmarks"
```

---

### Task 2: Benchmark Harness

**Files:**

- Create: `src/benchmark.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create benchmark harness**

```typescript
// src/benchmark.ts
import { performance } from "perf_hooks";
import { statSync } from "fs";

export interface PhaseResult {
  name: string;
  ms: number;
}

export interface BenchmarkResult {
  indexing_ms: number;
  db_size_bytes: number;
  peak_memory_bytes: number;
  file_count: number;
  files_per_second: number;
  phases: PhaseResult[];
}

export class Benchmark {
  private phases: PhaseResult[] = [];
  private startTime = 0;
  private peakMemory = 0;

  start(): void {
    this.startTime = performance.now();
    this.peakMemory = process.memoryUsage().heapUsed;
  }

  startPhase(name: string): () => void {
    const phaseStart = performance.now();
    return () => {
      this.phases.push({ name, ms: Math.round(performance.now() - phaseStart) });
      const mem = process.memoryUsage().heapUsed;
      if (mem > this.peakMemory) this.peakMemory = mem;
    };
  }

  finish(dbPath: string, fileCount: number): BenchmarkResult {
    const totalMs = Math.round(performance.now() - this.startTime);
    let dbSize = 0;
    try {
      dbSize = statSync(dbPath).size;
    } catch {
      /* in-memory DB */
    }

    return {
      indexing_ms: totalMs,
      db_size_bytes: dbSize,
      peak_memory_bytes: this.peakMemory,
      file_count: fileCount,
      files_per_second: fileCount > 0 ? Math.round(fileCount / (totalMs / 1000)) : 0,
      phases: this.phases,
    };
  }
}
```

- [ ] **Step 2: Add benchmark script to package.json**

Add to `scripts` in `package.json`:

```json
"benchmark": "tsx tests/benchmark/run-benchmark.ts"
```

- [ ] **Step 3: Create benchmark runner**

```typescript
// tests/benchmark/run-benchmark.ts
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateFixture } from "./generate-fixture.js";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { Benchmark } from "../../src/benchmark.js";

async function run() {
  const preset = process.argv[2] ?? "small";
  console.log(`Generating ${preset} fixture...`);

  const tmpDir = mkdtempSync(join(tmpdir(), "unity-bench-"));
  const fixtureDir = join(tmpDir, "project");
  const dbPath = join(tmpDir, "bench.db");

  try {
    generateFixture(fixtureDir, preset);
    await initScriptParser();

    const bench = new Benchmark();
    bench.start();

    const store = new Store(dbPath);
    const indexer = new Indexer(store, fixtureDir);

    indexer.indexAll();

    const files = store.listFiles();
    const result = bench.finish(dbPath, files.length);

    console.log(JSON.stringify(result, null, 2));
    store.close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run baseline benchmark**

Run: `npx tsx tests/benchmark/run-benchmark.ts small`
Expected: outputs JSON with indexing_ms, db_size_bytes, etc. Save this output as baseline.

- [ ] **Step 5: Commit**

```bash
git add src/benchmark.ts tests/benchmark/run-benchmark.ts package.json
git commit -m "feat: add benchmark harness with synthetic fixture runner"
```

---

### Task 3: Prepared Statement Cache in Store

**Files:**

- Modify: `src/db/store.ts`
- Modify: `tests/db/store.test.ts`

- [ ] **Step 1: Write test for statement caching behavior**

Add to `tests/db/store.test.ts`:

```typescript
describe("prepared statement caching", () => {
  it("returns same result on repeated calls without errors", () => {
    const fileId = store.upsertFile(makeFile());
    // Call same method twice to exercise cache path
    const fileId2 = store.upsertFile(makeFile({ content_hash: "def456" }));
    expect(fileId).toBe(fileId2); // same path → same id via upsert
  });
});
```

- [ ] **Step 2: Run test to verify it passes with current code**

Run: `npx vitest run tests/db/store.test.ts -t "prepared statement caching"`
Expected: PASS (baseline — test works with current non-cached approach too)

- [ ] **Step 3: Add statement cache to Store class**

In `src/db/store.ts`, add after `private db: DatabaseType;` (line 92):

```typescript
private stmtCache = new Map<string, ReturnType<DatabaseType["prepare"]>>();

private prepare(sql: string): ReturnType<DatabaseType["prepare"]> {
  let stmt = this.stmtCache.get(sql);
  if (!stmt) {
    stmt = this.db.prepare(sql);
    this.stmtCache.set(sql, stmt);
  }
  return stmt;
}
```

- [ ] **Step 4: Replace all `this.db.prepare(...)` calls with `this.prepare(...)`**

Replace every occurrence of `this.db.prepare(` with `this.prepare(` in store.ts, EXCEPT:

- Line 98: `this.db.exec(SCHEMA_SQL)` — this uses `exec`, not `prepare` — leave it
- Lines 665-686: `this.db.exec(...)` in `recomputeReferenceCounts` — uses `exec` — leave it
- Lines 700-722: `deleteFileData` transaction — these DELETE statements change with each call but the SQL is static, so DO replace them

The `listScripts` method (line 412) uses dynamic SQL — this one stays as `this.db.prepare()` since the SQL varies with filters.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: all 167 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/db/store.ts tests/db/store.test.ts
git commit -m "perf: add prepared statement cache to Store"
```

---

### Task 4: Add Missing Indexes

**Files:**

- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add indexes to schema**

In `src/db/schema.ts`, add after the `idx_scripts_assembly_name` index (line 102):

```sql
CREATE INDEX IF NOT EXISTS idx_scripts_file_id
  ON scripts (file_id);

CREATE INDEX IF NOT EXISTS idx_guids_file_id
  ON guids (file_id);
```

Note: `idx_components_script_guid` already exists at line 76. No need to add.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass (indexes are transparent to queries)

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "perf: add missing indexes on scripts.file_id and guids.file_id"
```

---

### Task 5: Eliminate N+1 in buildGuidToClassMap

**Files:**

- Modify: `src/db/store.ts`
- Modify: `src/indexer/indexer.ts`
- Modify: `tests/db/store.test.ts`

- [ ] **Step 1: Write test for new store method**

Add to `tests/db/store.test.ts`:

```typescript
describe("getGuidToClassMap", () => {
  it("maps script GUID to class name for MonoBehaviours", () => {
    // Insert script file + meta file + guid + script
    const scriptFileId = store.upsertFile(
      makeFile({ path: "Assets/Scripts/Foo.cs", type: "script" }),
    );
    const metaFileId = store.upsertFile(
      makeFile({ path: "Assets/Scripts/Foo.cs.meta", type: "meta" }),
    );
    store.upsertGuid({ guid: "abc123guid", file_id: metaFileId, asset_type: "script" });
    store.insertScript({
      file_id: scriptFileId,
      class_name: "Foo",
      namespace: "",
      base_class: "MonoBehaviour",
      interfaces: "[]",
      assembly_name: "",
      api_summary: "",
      complexity_score: 1,
      is_monobehaviour: true,
      is_editor_script: false,
      is_scriptable_object: false,
      is_generated: false,
    });

    const map = store.getGuidToClassMap();
    expect(map.get("abc123guid")).toBe("Foo");
  });

  it("excludes non-MonoBehaviour scripts", () => {
    const scriptFileId = store.upsertFile(
      makeFile({ path: "Assets/Scripts/Bar.cs", type: "script" }),
    );
    const metaFileId = store.upsertFile(
      makeFile({ path: "Assets/Scripts/Bar.cs.meta", type: "meta" }),
    );
    store.upsertGuid({ guid: "bar123guid", file_id: metaFileId, asset_type: "script" });
    store.insertScript({
      file_id: scriptFileId,
      class_name: "Bar",
      namespace: "",
      base_class: "",
      interfaces: "[]",
      assembly_name: "",
      api_summary: "",
      complexity_score: 1,
      is_monobehaviour: false,
      is_editor_script: false,
      is_scriptable_object: false,
      is_generated: false,
    });

    const map = store.getGuidToClassMap();
    expect(map.has("bar123guid")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/store.test.ts -t "getGuidToClassMap"`
Expected: FAIL — `store.getGuidToClassMap is not a function`

- [ ] **Step 3: Implement getGuidToClassMap in Store**

Add to `src/db/store.ts` after `getGuidByFileId` method (after line 493):

```typescript
getGuidToClassMap(): Map<string, string> {
  const rows = this.prepare(`
    SELECT s.class_name, g.guid
    FROM scripts s
    JOIN files f ON s.file_id = f.id
    JOIN files mf ON mf.path = f.path || '.meta'
    JOIN guids g ON g.file_id = mf.id
    WHERE s.is_monobehaviour = 1
  `).all() as { class_name: string; guid: string }[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.guid, row.class_name);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/store.test.ts -t "getGuidToClassMap"`
Expected: PASS

- [ ] **Step 5: Replace buildGuidToClassMap in Indexer**

In `src/indexer/indexer.ts`, replace the `buildGuidToClassMap` method (lines 597-619):

```typescript
private buildGuidToClassMap(): Map<string, string> {
  return this.store.getGuidToClassMap();
}
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/db/store.ts src/indexer/indexer.ts tests/db/store.test.ts
git commit -m "perf: replace N+1 buildGuidToClassMap with single JOIN query"
```

---

### Task 6: Fix listScripts().find() in updateProjectSummary

**Files:**

- Modify: `src/db/store.ts`
- Modify: `src/indexer/indexer.ts`
- Modify: `tests/db/store.test.ts`

- [ ] **Step 1: Write test for getScriptByFileId**

Add to `tests/db/store.test.ts`:

```typescript
describe("getScriptByFileId", () => {
  it("returns script for file_id", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scripts/Test.cs", type: "script" }));
    store.insertScript({
      file_id: fileId,
      class_name: "TestClass",
      namespace: "",
      base_class: "",
      interfaces: "[]",
      assembly_name: "",
      api_summary: "",
      complexity_score: 1,
      is_monobehaviour: false,
      is_editor_script: false,
      is_scriptable_object: false,
      is_generated: false,
    });

    const script = store.getScriptByFileId(fileId);
    expect(script?.class_name).toBe("TestClass");
  });

  it("returns undefined when no script for file_id", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scenes/X.unity", type: "scene" }));
    expect(store.getScriptByFileId(fileId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/store.test.ts -t "getScriptByFileId"`
Expected: FAIL — method doesn't exist

- [ ] **Step 3: Add getScriptByFileId to Store**

Add to `src/db/store.ts` after `getScriptByClassName` (after line 422):

```typescript
getScriptByFileId(fileId: number): (ScriptRow & { id: number }) | undefined {
  const row = this.prepare("SELECT * FROM scripts WHERE file_id = ? LIMIT 1").get(fileId) as
    | Record<string, unknown>
    | undefined;
  return row ? scriptRowOut(row) : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/store.test.ts -t "getScriptByFileId"`
Expected: PASS

- [ ] **Step 5: Replace listScripts().find() in updateProjectSummary**

In `src/indexer/indexer.ts`, replace the hot scripts loop (lines 638-651):

```typescript
const topRefs = this.store.getTopReferencedFiles(10);
const hotScripts: string[] = [];
for (const ref of topRefs) {
  if (ref.incoming_count === 0) continue;
  const file = this.store.getFileById(ref.file_id);
  if (file?.type === "meta") {
    const assetPath = file.path.endsWith(".meta") ? file.path.slice(0, -5) : file.path;
    const assetFile = this.store.getFileByPath(assetPath);
    if (assetFile?.type === "script") {
      const script = this.store.getScriptByFileId(assetFile.id);
      if (script) hotScripts.push(script.class_name);
    }
  }
}
```

The only change is line `const script = this.store.getScriptByFileId(assetFile.id);` replacing `const script = this.store.listScripts().find((s) => s.file_id === assetFile.id);`.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/db/store.ts src/indexer/indexer.ts tests/db/store.test.ts
git commit -m "perf: replace listScripts().find() with direct getScriptByFileId query"
```

---

### Task 7: Eliminate Redundant Hash Computation

**Files:**

- Modify: `src/indexer/indexer.ts`

- [ ] **Step 1: Pass content and hash to type-specific indexers**

In `src/indexer/indexer.ts`, change the dispatch block in `indexFileInternal` (lines 196-216). First, update the method signatures of each type-specific indexer to accept `contentHash: string` instead of recomputing it. Then remove the `createHash` calls inside each one.

Replace the switch block and the second `upsertFile` calls in each indexer:

Change `indexScene` signature from:

```typescript
private indexScene(fileId: number, relativePath: string, content: string): void {
```

to:

```typescript
private indexScene(fileId: number, relativePath: string, content: string, contentHash: string): void {
```

And replace `content_hash: createHash("sha256").update(content).digest("hex"),` with `content_hash: contentHash,` in its `upsertFile` call.

Do the same for `indexPrefab`, `indexAssetFile`, `indexScript`, and `indexAsmDef`.

Update the switch block to pass `contentHash`:

```typescript
switch (fileType) {
  case "meta":
    this.indexMeta(fileId, content);
    break;
  case "scene":
    this.indexScene(fileId, relativePath, content, contentHash);
    break;
  case "prefab":
    this.indexPrefab(fileId, relativePath, content, contentHash);
    break;
  case "asset":
    this.indexAssetFile(fileId, relativePath, content, contentHash);
    break;
  case "script":
    this.indexScript(fileId, relativePath, content, contentHash);
    break;
  case "asmdef":
    this.indexAsmDef(fileId, relativePath, content, contentHash);
    break;
}
```

Also remove the `import { createHash } from "crypto";` usage in each sub-method — keep only the one in `indexFileInternal` at line 166.

Note: the `createHash("md5")` call in `storeGameObjects` (line 551) for `pattern_hash` is different — keep that one.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "perf: pass content hash to sub-indexers instead of recomputing"
```

---

### Task 8: Deduplicate buildGuidToClassMap Calls

**Files:**

- Modify: `src/indexer/indexer.ts`

- [ ] **Step 1: Remove fallback rebuilds in indexScene and indexPrefab**

In `indexScene` (line 254), change:

```typescript
const guidToClass = this.guidToClassCache ?? this.buildGuidToClassMap();
```

to:

```typescript
const guidToClass = (this.guidToClassCache ??= this.buildGuidToClassMap());
```

Same change in `indexPrefab` (line 289).

Using `??=` ensures the cache is set if it was null, so subsequent calls reuse it. This handles both the `indexAll()` path (where cache is pre-built) and the `indexFile()` path (where cache is lazily built once).

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "perf: lazy-cache guidToClassMap, eliminate redundant rebuilds"
```

---

### Task 9: Single-Pass Hierarchy Computation

**Files:**

- Modify: `src/indexer/indexer.ts`

- [ ] **Step 1: Replace dual tree walks with single pass**

In `src/indexer/indexer.ts`, replace the `storeGameObjects` method (lines 451-575) with a single-pass version.

Replace the depth computation (lines 470-503) and the insertGo function (lines 508-570) with:

```typescript
private storeGameObjects(
  fileId: number,
  gameObjects: ParsedGameObject[],
  guidToClass: Map<string, string>,
): void {
  const childMap = new Map<string, ParsedGameObject[]>();
  const roots: ParsedGameObject[] = [];

  for (const go of gameObjects) {
    if (go.parentFileIdLocal !== null) {
      const siblings = childMap.get(go.parentFileIdLocal) ?? [];
      siblings.push(go);
      childMap.set(go.parentFileIdLocal, siblings);
    } else {
      roots.push(go);
    }
  }

  const siblingCounters = new Map<string, number>();

  const insertRecursive = (go: ParsedGameObject, depth: number): number => {
    const children = childMap.get(go.fileIdLocal) ?? [];
    const parentKey = go.parentFileIdLocal ?? "__root__";
    const idx = siblingCounters.get(parentKey) ?? 0;
    siblingCounters.set(parentKey, idx + 1);

    // Recurse first to compute subtree depth
    let maxChildSubtreeDepth = -1;
    for (const child of children) {
      const childSubtreeDepth = insertRecursive(child, depth + 1);
      if (childSubtreeDepth > maxChildSubtreeDepth) maxChildSubtreeDepth = childSubtreeDepth;
    }
    const subtreeDepth = children.length === 0 ? 0 : maxChildSubtreeDepth + 1;

    const childNames = children.map((c) => c.name);
    const isLeaf = children.length === 0;
    const componentSummary = generateComponentSummary(go.components, guidToClass);
    const subtreeSummary = generateSubtreeSummary(go.name, childNames);
    const hasMonoBehaviour = go.components.some((c) => c.typeName === "MonoBehaviour");

    const importance = computeGameObjectImportance({
      hasMonoBehaviour,
      childCount: children.length,
      depth,
      refCount: 0,
    });

    const goId = this.store.insertGameObject({
      file_id: fileId,
      file_id_local: go.fileIdLocal,
      name: go.name,
      parent_file_id_local: go.parentFileIdLocal,
      depth,
      sibling_index: idx,
      active: go.active,
      layer: go.layer,
      tag: go.tag,
      component_summary: componentSummary,
      subtree_summary: subtreeSummary,
      is_leaf: isLeaf,
      child_count: children.length,
      subtree_depth: subtreeDepth,
      importance_score: importance,
    });

    for (const comp of go.components) {
      const fieldSummary = generateFieldSummary(comp.serializedFields, guidToClass);
      const patternHash = createHash("md5")
        .update(comp.typeName + JSON.stringify(Object.keys(comp.serializedFields).sort()))
        .digest("hex");

      this.store.insertComponent({
        game_object_id: goId,
        type_name: comp.typeName,
        script_guid: comp.scriptGuid,
        order: comp.order,
        serialized_fields: JSON.stringify(comp.serializedFields),
        field_summary: fieldSummary,
        pattern_hash: patternHash,
      });
    }

    return subtreeDepth;
  };

  for (const root of roots) {
    insertRecursive(root, 0);
  }
}
```

Note: this changes insertion order — children are inserted before parents (post-order). This is fine because the DB uses `file_id_local` for hierarchy, not insertion order. The `depth` and `sibling_index` fields are still correct.

Wait — actually we need parents before children for proper ordering. Let me fix: we should insert the parent AFTER computing subtree depth but BEFORE recursing. Actually no — we need subtree depth which requires recursing first. The insertion order doesn't matter for correctness since hierarchy is reconstructed via `parent_file_id_local`. Let me verify the query in `getGameObjectsByFile` uses `ORDER BY depth, sibling_index` — yes it does (store.ts line 204). So insertion order doesn't matter.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "perf: single-pass hierarchy computation replaces dual tree walks"
```

---

### Task 10: Consolidate Transform Maps in Scene Parser

**Files:**

- Modify: `src/parsers/scene-parser.ts`

- [ ] **Step 1: Remove goToTransform map**

In `src/parsers/scene-parser.ts`, the `goToTransform` map (line 30) is built but never read. Only `transformToGo` is used (lines 47, 61, 74).

Remove line 30: `const goToTransform = new Map<string, string>();`
Remove line 48: `goToTransform.set(goFileId, doc.fileId);`

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/parsers/scene-parser.ts
git commit -m "perf: remove unused goToTransform map from scene parser"
```

---

### Task 11: Compact MCP Responses — Drop Default Values

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Update tests for new compact response shapes**

In `tests/mcp/tools.test.ts`, update the scene hierarchy test to accept that `active` and `tag` may be omitted when they're defaults:

```typescript
it("returns roots with name/components/token_hint for MainScene.unity", () => {
  const result = handleGetSceneHierarchy(store, {
    scene: "Assets/Scenes/MainScene.unity",
  }) as Record<string, unknown>;

  expect(result.token_hint).toBeDefined();
  expect(typeof result.token_hint).toBe("number");
  expect(result.roots).toBeDefined();
  const roots = result.roots as Array<Record<string, unknown>>;
  expect(roots.length).toBeGreaterThan(0);
  const first = roots[0];
  expect(first).toHaveProperty("name");
  expect(first).toHaveProperty("components");
  // active and tag omitted when default (true / "Untagged")
});
```

Add a new test:

```typescript
it("omits default values from response", () => {
  const result = handleGetSceneHierarchy(store, {
    scene: "Assets/Scenes/MainScene.unity",
  }) as Record<string, unknown>;

  const roots = result.roots as Array<Record<string, unknown>>;
  for (const root of roots) {
    // active should only be present when false
    if ("active" in root) {
      expect(root.active).toBe(false);
    }
    // tag should only be present when not "Untagged"
    if ("tag" in root) {
      expect(root.tag).not.toBe("Untagged");
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts -t "omits default values"`
Expected: FAIL — current code includes `active: true` and `tag: "Untagged"`

- [ ] **Step 3: Update handleGetSceneHierarchy to omit defaults**

In `src/mcp/tools.ts`, replace the roots mapping (lines 51-58):

```typescript
roots: roots.map((go) => ({
  name: go.name,
  components: go.component_summary,
  children_summary: go.subtree_summary,
  importance: go.importance_score,
  ...(go.tag !== "Untagged" ? { tag: go.tag } : {}),
  ...(!go.active ? { active: false } : {}),
})),
```

- [ ] **Step 4: Update handleGetGameObject to omit defaults**

In `src/mcp/tools.ts`, replace the return object in handleGetGameObject (lines 145-161):

```typescript
return {
  token_hint: 50,
  name: go.name,
  ...(resolvedFrom !== undefined ? { resolved_from: resolvedFrom, is_variant: true } : {}),
  ...(go.tag !== "Untagged" ? { tag: go.tag } : {}),
  ...(go.layer !== 0 ? { layer: go.layer } : {}),
  ...(!go.active ? { active: false } : {}),
  depth: go.depth,
  ...(go.child_count > 0 ? { child_count: go.child_count } : {}),
  importance: go.importance_score,
  components: components.map((c) => ({
    type_name: c.type_name,
    ...(c.script_guid ? { script_guid: c.script_guid } : {}),
    field_summary: c.field_summary,
    serialized_fields: JSON.parse(c.serialized_fields) as unknown,
  })),
};
```

- [ ] **Step 5: Update handleListScripts to omit defaults**

In `src/mcp/tools.ts`, replace the scripts mapping (lines 91-100):

```typescript
scripts: scripts.map((s) => ({
  class_name: s.class_name,
  ...(s.namespace ? { namespace: s.namespace } : {}),
  ...(s.base_class ? { base_class: s.base_class } : {}),
  api_summary: s.api_summary,
  ...(s.is_monobehaviour ? { is_monobehaviour: true } : {}),
  ...(s.is_generated ? { is_generated: true } : {}),
  complexity: s.complexity_score,
})),
```

- [ ] **Step 6: Update handleGetScriptDetail to omit defaults**

In `src/mcp/tools.ts`, replace the return in handleGetScriptDetail (lines 216-237):

```typescript
return {
  token_hint: 20 + members.length * 5,
  class_name: script.class_name,
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
  members: members.map((m) => ({
    name: m.name,
    kind: m.kind,
    ...(m.access !== "public" ? { access: m.access } : {}),
    signature: m.signature,
    ...((JSON.parse(m.attributes) as string[]).length > 0
      ? { attributes: JSON.parse(m.attributes) as string[] }
      : {}),
    ...(m.has_serialize_field ? { has_serialize_field: true } : {}),
  })),
};
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: all tests pass (update any tests that assert on fields that are now omitted)

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "perf: omit default values from MCP responses to reduce tokens"
```

---

### Task 12: Dynamic Token Hints

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Add estimateTokens helper**

At the top of `src/mcp/tools.ts` (after imports):

```typescript
function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}
```

- [ ] **Step 2: Replace static token hints in all handlers**

For each handler, compute the response object first, then set `token_hint` based on actual size. Pattern:

```typescript
// Example for handleGetSceneHierarchy
const response = {
  scene: params.scene,
  ...(resolvedFrom !== undefined ? { resolved_from: resolvedFrom, is_variant: true } : {}),
  roots: roots.map((go) => ({
    // ... same as current
  })),
};
return { token_hint: estimateTokens(response), ...response };
```

Apply this pattern to all 12 handler functions. The `token_hint` field is always set from `estimateTokens(response)` where `response` is the rest of the object.

- [ ] **Step 3: Update test assertions**

In `tests/mcp/tools.test.ts`, token_hint assertions already just check `typeof result.token_hint === "number"` — these should still pass. But verify the `handleRecentChanges` limit test still works since token_hint now varies.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "perf: dynamic token hints based on actual response size"
```

---

### Task 13: Eliminate Redundant JSON Round-Trips

**Files:**

- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Identify and fix parse-then-reserialize patterns**

In `handleGetScriptDetail`, the `attributes` field is parsed twice per member (lines 234, 232). Cache it:

```typescript
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
```

In `handleGetGameObject` (line 159), `JSON.parse(c.serialized_fields)` is needed — can't avoid it. But we should check: does the MCP SDK re-stringify? Yes — `toContent` on line 491 does `JSON.stringify(obj, null, 2)`. So the full flow is: stored as JSON string → parsed to object → re-stringified by toContent. We can't eliminate this without changing the toContent approach, which would require raw JSON embedding in the MCP response. This is a minor gain — skip for now.

In `handleGetScriptMember` (lines 266-267), `parameters` and `attributes` are parsed individually. Cache them:

```typescript
const params = JSON.parse(member.parameters) as unknown;
const attrs = JSON.parse(member.attributes) as string[];
return {
  token_hint: 15,
  class_name: script.class_name,
  name: member.name,
  kind: member.kind,
  access: member.access,
  return_type: member.return_type,
  parameters: params,
  ...(attrs.length > 0 ? { attributes: attrs } : {}),
  signature: member.signature,
  ...(member.has_serialize_field ? { has_serialize_field: true } : {}),
  ...(member.has_header_attr ? { has_header_attr: true } : {}),
};
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "perf: cache parsed JSON to avoid redundant parse calls"
```

---

### Task 14: Run Post-Optimization Benchmark

**Files:**

- No file changes — measurement only

- [ ] **Step 1: Run benchmark with same preset as baseline**

Run: `npx tsx tests/benchmark/run-benchmark.ts small`
Expected: outputs JSON. Compare indexing_ms, db_size_bytes against baseline from Task 2.

- [ ] **Step 2: Run medium benchmark for scale validation**

Run: `npx tsx tests/benchmark/run-benchmark.ts medium`
Expected: completes without errors. Note timing.

- [ ] **Step 3: Final full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 15: Add Phase Timing to Indexer

**Files:**

- Modify: `src/indexer/indexer.ts`
- Modify: `src/benchmark.ts`

- [ ] **Step 1: Add optional benchmark parameter to Indexer**

In `src/indexer/indexer.ts`, update the constructor:

```typescript
constructor(
  private store: Store,
  private projectRoot: string,
  private benchmark?: Benchmark,
) {}
```

- [ ] **Step 2: Add phase timing to indexAll**

In `indexAll()`, wrap each phase:

```typescript
indexAll(): void {
  const files = this.collectFiles();
  log(`found ${String(files.length)} files to index`);

  const metaFiles = files.filter((f) => f.endsWith(".meta"));
  const otherFiles = files.filter((f) => !f.endsWith(".meta"));

  const scripts = otherFiles.filter((f) => f.endsWith(".cs"));
  const asmdefs = otherFiles.filter((f) => f.endsWith(".asmdef"));
  const assets = otherFiles.filter((f) => f.endsWith(".asset"));
  const scenesAndPrefabs = otherFiles.filter(
    (f) => f.endsWith(".unity") || f.endsWith(".prefab"),
  );

  let endPhase: (() => void) | undefined;

  endPhase = this.benchmark?.startPhase("meta");
  log(`indexing ${String(metaFiles.length)} meta files...`);
  this.indexBatch(metaFiles);
  endPhase?.();

  if (scripts.length > 0) {
    endPhase = this.benchmark?.startPhase("scripts");
    log(`indexing ${String(scripts.length)} script files...`);
    this.indexBatch(scripts);
    endPhase?.();
  }
  if (asmdefs.length > 0) {
    endPhase = this.benchmark?.startPhase("asmdefs");
    log(`indexing ${String(asmdefs.length)} asmdef files...`);
    this.indexBatch(asmdefs);
    endPhase?.();
  }
  if (assets.length > 0) {
    endPhase = this.benchmark?.startPhase("assets");
    log(`indexing ${String(assets.length)} asset files...`);
    this.indexBatch(assets);
    endPhase?.();
  }

  endPhase = this.benchmark?.startPhase("guid_map");
  log("building GUID → class map...");
  this.guidToClassCache = this.buildGuidToClassMap();
  endPhase?.();

  if (scenesAndPrefabs.length > 0) {
    endPhase = this.benchmark?.startPhase("scenes_prefabs");
    log(`indexing ${String(scenesAndPrefabs.length)} scene/prefab files...`);
    this.indexBatch(scenesAndPrefabs);
    endPhase?.();
  }

  this.guidToClassCache = null;

  endPhase = this.benchmark?.startPhase("ref_counts");
  log("recomputing reference counts...");
  this.store.recomputeReferenceCounts();
  endPhase?.();

  endPhase = this.benchmark?.startPhase("summary");
  this.updateProjectSummary();
  endPhase?.();
}
```

- [ ] **Step 3: Update benchmark runner to pass Benchmark to Indexer**

In `tests/benchmark/run-benchmark.ts`, change:

```typescript
const indexer = new Indexer(store, fixtureDir);
```

to:

```typescript
const indexer = new Indexer(store, fixtureDir, bench);
```

- [ ] **Step 4: Run benchmark to see phase breakdown**

Run: `npx tsx tests/benchmark/run-benchmark.ts small`
Expected: output now includes phases array with per-phase timing

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: all tests pass (benchmark param is optional, existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/indexer/indexer.ts src/benchmark.ts tests/benchmark/run-benchmark.ts
git commit -m "feat: add per-phase timing to indexer benchmark"
```

---

### Task 16: Compact MCP Response Formatting

**Files:**

- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Remove pretty-printing from toContent**

In `src/mcp/tools.ts` line 492, change:

```typescript
const toContent = (obj: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
});
```

to:

```typescript
const toContent = (obj: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj) }],
});
```

This alone saves significant tokens — `null, 2` adds whitespace that inflates every response. The LLM parses JSON fine without formatting.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "perf: remove JSON pretty-printing from MCP responses"
```

---

### Task 17: Final Validation

**Files:**

- No changes — validation only

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: no errors

- [ ] **Step 4: Final benchmark comparison**

Run: `npx tsx tests/benchmark/run-benchmark.ts small`
Compare against baseline saved in Task 2.

- [ ] **Step 5: Medium benchmark**

Run: `npx tsx tests/benchmark/run-benchmark.ts medium`
Expected: completes in reasonable time
