import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, basename } from "path";
import { createHash } from "crypto";
import type { Store } from "../db/store.js";
import { parseScene } from "../parsers/scene-parser.js";
import { parsePrefab } from "../parsers/prefab-parser.js";
import { parseAsset } from "../parsers/asset-parser.js";
import { parseScript } from "../parsers/script-parser.js";
import { parseMeta } from "../parsers/meta-parser.js";
import { parseAsmDef } from "../parsers/asmdef-parser.js";
import type { Benchmark } from "../benchmark.js";
import {
  generateComponentSummary,
  generateSubtreeSummary,
  generateFieldSummary,
  generateApiSummary,
  generateMemberSignature,
  generateFileSummaryLine,
  computeGameObjectImportance,
  computeFileImportance,
} from "../db/summaries.js";
import { extractRelationships, extractTypeReferences } from "../parsers/relationship-extractor.js";
import { detectFileType } from "../types.js";
import type {
  ParsedGameObject,
  ParsedGuidReference,
  GraphEdgeRow,
  GraphEdgeType,
} from "../types.js";

function log(msg: string): void {
  console.error(`[unity-indexer] ${msg}`);
}

export class Indexer {
  private guidToClassCache: Map<string, string> | null = null;
  private pendingScenesAndPrefabs: string[] = [];

  constructor(
    private store: Store,
    private projectRoot: string,
    private benchmark?: Benchmark,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  indexAll(): void {
    const files = this.collectFiles();
    log(`found ${String(files.length)} files to index`);

    const metaFiles = files.filter((f) => f.endsWith(".meta"));
    const otherFiles = files.filter((f) => !f.endsWith(".meta"));

    let endPhase: (() => void) | undefined;

    // Index meta files first in batches (GUID registry needed by other parsers)
    log(`indexing ${String(metaFiles.length)} meta files...`);
    endPhase = this.benchmark?.startPhase("meta");
    this.indexBatch(metaFiles);
    endPhase?.();

    // Index scripts before scenes/prefabs so guidToClassMap is populated
    const scripts = otherFiles.filter((f) => f.endsWith(".cs"));
    const asmdefs = otherFiles.filter((f) => f.endsWith(".asmdef"));
    const assets = otherFiles.filter((f) => f.endsWith(".asset"));
    const scenesAndPrefabs = otherFiles.filter(
      (f) => f.endsWith(".unity") || f.endsWith(".prefab"),
    );

    if (scripts.length > 0) {
      log(`indexing ${String(scripts.length)} script files...`);
      endPhase = this.benchmark?.startPhase("scripts");
      this.indexBatch(scripts);
      endPhase?.();

      // Second pass: build cross-script edges now that all scripts are inserted
      log("building cross-script edges...");
      endPhase = this.benchmark?.startPhase("script_edges");
      this.store.transaction(() => {
        for (const relPath of scripts) {
          this.indexScriptCrossEdges(relPath);
        }
      });
      endPhase?.();

      log("propagating MonoBehaviour inheritance...");
      endPhase = this.benchmark?.startPhase("mb_propagate");
      this.store.propagateMonoBehaviourInheritance();
      endPhase?.();
    }
    if (asmdefs.length > 0) {
      log(`indexing ${String(asmdefs.length)} asmdef files...`);
      endPhase = this.benchmark?.startPhase("asmdefs");
      this.indexBatch(asmdefs);
      endPhase?.();

      log("assigning assembly names to scripts...");
      endPhase = this.benchmark?.startPhase("assembly_assign");
      this.store.assignScriptAssemblies();
      endPhase?.();
    }
    if (assets.length > 0) {
      log(`indexing ${String(assets.length)} asset files...`);
      endPhase = this.benchmark?.startPhase("assets");
      this.indexBatch(assets);
      endPhase?.();
    }

    // Build guid→class map once now that all scripts + metas are indexed
    log("building GUID → class map...");
    endPhase = this.benchmark?.startPhase("guid_map");
    this.guidToClassCache = this.buildGuidToClassMap();
    endPhase?.();

    if (scenesAndPrefabs.length > 0) {
      log(`indexing ${String(scenesAndPrefabs.length)} scene/prefab files...`);
      endPhase = this.benchmark?.startPhase("scenes_prefabs");
      this.indexBatch(scenesAndPrefabs);
      endPhase?.();
    }

    this.guidToClassCache = null;

    log("recomputing reference counts...");
    endPhase = this.benchmark?.startPhase("ref_counts");
    this.store.recomputeReferenceCounts();
    endPhase?.();

    log("hydrating graph...");
    endPhase = this.benchmark?.startPhase("graph");
    this.store.hydrateGraph();
    endPhase?.();

    endPhase = this.benchmark?.startPhase("summary");
    this.updateProjectSummary();
    endPhase?.();
  }

  /**
   * Index everything except scenes/prefabs, then return.
   * Call indexScenesAndPrefabsBackground() to finish in the background.
   * Useful for server startup: scripts are available to MCP tools immediately.
   * Async so the event loop stays responsive (MCP handshake can complete between batches).
   */
  async indexEssential(): Promise<void> {
    // Yield before any blocking work so the MCP initialize handshake can complete
    await new Promise<void>((resolve) => setImmediate(resolve));

    const files = this.collectFiles();
    // collectFiles blocks on large filesystems — yield again after
    await new Promise<void>((resolve) => setImmediate(resolve));
    log(`found ${String(files.length)} files to index`);

    const metaFiles = files.filter((f) => f.endsWith(".meta"));
    const otherFiles = files.filter((f) => !f.endsWith(".meta"));
    const scripts = otherFiles.filter((f) => f.endsWith(".cs"));
    const asmdefs = otherFiles.filter((f) => f.endsWith(".asmdef"));
    const assets = otherFiles.filter((f) => f.endsWith(".asset"));

    this.pendingScenesAndPrefabs = otherFiles.filter(
      (f) => f.endsWith(".unity") || f.endsWith(".prefab"),
    );

    if (metaFiles.length > 0) {
      log(`indexing ${String(metaFiles.length)} meta files...`);
      await this.indexBatchAsync(metaFiles);
    }

    if (scripts.length > 0) {
      log(`indexing ${String(scripts.length)} script files...`);
      await this.indexBatchAsync(scripts);

      log("building cross-script edges...");
      const crossEdgeBatchSize = 500;
      for (let i = 0; i < scripts.length; i += crossEdgeBatchSize) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const batch = scripts.slice(i, i + crossEdgeBatchSize);
        this.store.transaction(() => {
          for (const relPath of batch) {
            this.indexScriptCrossEdges(relPath);
          }
        });
      }

      log("propagating MonoBehaviour inheritance...");
      this.store.propagateMonoBehaviourInheritance();
    }

    if (asmdefs.length > 0) {
      log(`indexing ${String(asmdefs.length)} asmdef files...`);
      await this.indexBatchAsync(asmdefs);

      log("assigning assembly names to scripts...");
      this.store.assignScriptAssemblies();
    }

    if (assets.length > 0) {
      log(`indexing ${String(assets.length)} asset files...`);
      await this.indexBatchAsync(assets);
    }

    log("building GUID → class map...");
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.guidToClassCache = this.buildGuidToClassMap();
    // Keep guidToClassCache alive for the background scenes/prefabs pass

    log("recomputing reference counts...");
    this.store.recomputeReferenceCounts();

    log("hydrating graph...");
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.store.hydrateGraph();

    this.updateProjectSummary();
  }

  /**
   * Index scenes/prefabs in the background, yielding between batches so the
   * event loop can process MCP messages between chunks.
   * Must be called after indexEssential().
   */
  async indexScenesAndPrefabsBackground(): Promise<void> {
    const files = this.pendingScenesAndPrefabs;
    this.pendingScenesAndPrefabs = [];

    if (files.length === 0) {
      this.guidToClassCache = null;
      return;
    }

    log(`indexing ${String(files.length)} scene/prefab files in background...`);
    const batchSize = 500;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      // Yield to allow MCP messages to be processed between batches
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.store.transaction(() => {
        for (const relPath of batch) {
          this.indexFileInternal(relPath);
        }
      });
      if (files.length > batchSize) {
        log(`  ${String(Math.min(i + batchSize, files.length))}/${String(files.length)}`);
      }
    }

    this.guidToClassCache = null;
    this.store.recomputeReferenceCounts();
    this.store.hydrateGraph();
    this.updateProjectSummary();
  }

  private indexBatch(files: string[], batchSize = 500): void {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      this.store.transaction(() => {
        for (const relPath of batch) {
          this.indexFileInternal(relPath);
        }
      });
      if (files.length > batchSize && i + batchSize < files.length) {
        log(`  ${String(Math.min(i + batchSize, files.length))}/${String(files.length)}`);
      }
    }
  }

  private async indexBatchAsync(files: string[], batchSize = 500): Promise<void> {
    for (let i = 0; i < files.length; i += batchSize) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const batch = files.slice(i, i + batchSize);
      this.store.transaction(() => {
        for (const relPath of batch) {
          this.indexFileInternal(relPath);
        }
      });
      if (files.length > batchSize && i + batchSize < files.length) {
        log(`  ${String(Math.min(i + batchSize, files.length))}/${String(files.length)}`);
      }
    }
  }

  indexFile(relativePath: string): void {
    this.store.transaction(() => {
      this.indexFileInternal(relativePath);
    });
    if (relativePath.endsWith(".cs")) {
      this.store.transaction(() => {
        this.indexScriptCrossEdges(relativePath);
      });
    }
    // Incremental graph patch — only touch edges for this file, not the full graph
    const file = this.store.getFileByPath(relativePath);
    if (file) {
      this.store.patchGraphForFile(file.id, this.store.getGraphEdgesForFile(file.id));
    }
    this.store.recomputeReferenceCounts();
    this.updateProjectSummary();
  }

  removeFile(relativePath: string): void {
    const existing = this.store.getFileByPath(relativePath);
    if (!existing) return;

    const fileId = existing.id;
    this.store.transaction(() => {
      this.store.insertChangeLog({
        file_id: fileId,
        changed_at: new Date().toISOString(),
        change_type: "deleted",
      });
      this.store.deleteFileData(fileId);
      this.store.deleteFile(fileId);
    });

    // Incremental graph patch — remove stale in-memory edges for this file
    this.store.patchGraphForFile(fileId, []);
    this.store.recomputeReferenceCounts();
    this.updateProjectSummary();
  }

  /**
   * Process a batch of file-change events from the FileWatcher in one pass,
   * deferring the expensive recomputeReferenceCounts / updateProjectSummary
   * to run once at the end rather than once per file.
   */
  flushChanges(changes: ReadonlyMap<string, "add" | "change" | "unlink">): void {
    if (changes.size === 0) return;

    for (const [relativePath, event] of changes) {
      if (event === "unlink") {
        const existing = this.store.getFileByPath(relativePath);
        if (!existing) continue;
        const fileId = existing.id;
        this.store.transaction(() => {
          this.store.insertChangeLog({
            file_id: fileId,
            changed_at: new Date().toISOString(),
            change_type: "deleted",
          });
          this.store.deleteFileData(fileId);
          this.store.deleteFile(fileId);
        });
        this.store.patchGraphForFile(fileId, []);
      } else {
        this.store.transaction(() => {
          this.indexFileInternal(relativePath);
        });
        if (relativePath.endsWith(".cs")) {
          this.store.transaction(() => {
            this.indexScriptCrossEdges(relativePath);
          });
        }
        const file = this.store.getFileByPath(relativePath);
        if (file) {
          this.store.patchGraphForFile(file.id, this.store.getGraphEdgesForFile(file.id));
        }
      }
    }

    // Heavy ops deferred to run once for the whole batch
    this.store.recomputeReferenceCounts();
    this.updateProjectSummary();
  }

  // ---------------------------------------------------------------------------
  // Private: Graph edge helper
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Private: Core indexing
  // ---------------------------------------------------------------------------

  private indexFileInternal(relativePath: string): void {
    const fullPath = join(this.projectRoot, relativePath);

    // Fast path: stat + mtime check before reading the file
    const existing = this.store.getFileByPath(relativePath);
    let mtime: string | undefined;
    if (existing) {
      try {
        mtime = statSync(fullPath).mtime.toISOString();
        if (existing.modified_at === mtime) return;
      } catch {
        // stat failed — fall through to normal read
      }
    }

    // Read file content
    let content: string;
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      // File doesn't exist or unreadable — skip
      return;
    }

    const fileType = detectFileType(relativePath);
    if (!fileType) return;

    // Binary check: Unity YAML files must start with '%YAML'
    if (
      (fileType === "scene" || fileType === "prefab" || fileType === "asset") &&
      !content.trimStart().startsWith("%YAML")
    ) {
      this.store.upsertFile({
        path: relativePath,
        type: fileType,
        content_hash: "",
        modified_at: mtime ?? this.getModifiedTime(fullPath),
        indexed_at: new Date().toISOString(),
        summary_line: basename(relativePath),
        importance_score: 0,
        status: "binary",
      });
      return;
    }

    // Compute content hash
    const contentHash = createHash("sha256").update(content).digest("hex");

    // Secondary guard: hash check catches content changes without mtime change
    if (existing && existing.content_hash === contentHash) {
      return;
    }

    // Upsert the file row (initially with minimal data)
    const modifiedAt = mtime ?? this.getModifiedTime(fullPath);
    const changeType = existing ? "modified" : "added";

    const fileId = this.store.upsertFile({
      path: relativePath,
      type: fileType,
      content_hash: contentHash,
      modified_at: modifiedAt,
      indexed_at: new Date().toISOString(),
      summary_line: basename(relativePath),
      importance_score: 0,
      status: "ok",
    });

    // Clear old data if re-indexing
    if (existing) {
      this.store.deleteFileData(fileId);
    }

    // Dispatch to type-specific indexer
    try {
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

      // Log the change
      this.store.insertChangeLog({
        file_id: fileId,
        changed_at: new Date().toISOString(),
        change_type: changeType,
      });
    } catch {
      // Mark as partial on parse error
      this.store.upsertFile({
        path: relativePath,
        type: fileType,
        content_hash: contentHash,
        modified_at: modifiedAt,
        indexed_at: new Date().toISOString(),
        summary_line: basename(relativePath),
        importance_score: 0,
        status: "partial",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Type-specific indexers
  // ---------------------------------------------------------------------------

  private indexMeta(fileId: number, content: string): void {
    const parsed = parseMeta(content);
    this.store.upsertGuid({
      guid: parsed.guid,
      file_id: fileId,
      asset_type: parsed.assetType,
    });
  }

  private indexScene(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const parsed = parseScene(content);
    const guidToClass = (this.guidToClassCache ??= this.buildGuidToClassMap());

    this.storeGameObjects(fileId, parsed.gameObjects, guidToClass);
    this.storeReferences(fileId, parsed.references);

    const fileName = basename(relativePath);
    const scriptCount = parsed.gameObjects.reduce(
      (sum, go) => sum + go.components.filter((c) => c.typeName === "MonoBehaviour").length,
      0,
    );
    const summaryLine = generateFileSummaryLine("scene", fileName, {
      gameObjectCount: parsed.gameObjects.length,
      scriptCount,
    });
    const importance = computeFileImportance({
      incomingRefCount: 0,
      outgoingRefCount: parsed.references.length,
      hasCustomScripts: scriptCount > 0,
      changeFrequency: 0,
    });

    this.store.upsertFile({
      path: relativePath,
      type: "scene",
      content_hash: contentHash,
      modified_at: this.getModifiedTime(join(this.projectRoot, relativePath)),
      indexed_at: new Date().toISOString(),
      summary_line: summaryLine,
      importance_score: importance,
      status: "ok",
    });
  }

  private indexPrefab(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const parsed = parsePrefab(content);
    const guidToClass = (this.guidToClassCache ??= this.buildGuidToClassMap());

    this.storeGameObjects(fileId, parsed.gameObjects, guidToClass);
    this.storeReferences(fileId, parsed.references);

    const fileName = basename(relativePath);
    const summaryLine = generateFileSummaryLine("prefab", fileName, {
      isVariant: parsed.isVariant,
      gameObjectCount: parsed.gameObjects.length,
    });
    const hasCustomScripts = parsed.gameObjects.some((go) =>
      go.components.some((c) => c.typeName === "MonoBehaviour"),
    );
    const importance = computeFileImportance({
      incomingRefCount: 0,
      outgoingRefCount: parsed.references.length,
      hasCustomScripts,
      changeFrequency: 0,
    });

    this.store.upsertFile({
      path: relativePath,
      type: "prefab",
      content_hash: contentHash,
      modified_at: this.getModifiedTime(join(this.projectRoot, relativePath)),
      indexed_at: new Date().toISOString(),
      summary_line: summaryLine,
      importance_score: importance,
      status: "ok",
      source_prefab_guid: parsed.sourcePrefabGuid,
    });

    if (parsed.sourcePrefabGuid !== null) {
      const guidRow = this.store.resolveGuid(parsed.sourcePrefabGuid);
      if (guidRow) {
        const metaFile = this.store.getFileById(guidRow.file_id);
        if (metaFile) {
          const basePath = metaFile.path.endsWith(".meta")
            ? metaFile.path.slice(0, -5)
            : metaFile.path;
          const baseFile = this.store.getFileByPath(basePath);
          if (baseFile) {
            this.insertEdge("file", fileId, "file", baseFile.id, "VARIANT_OF", fileId);
          }
        }
      }
    }
  }

  private indexAssetFile(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const parsed = parseAsset(content);
    this.storeReferences(fileId, parsed.references);

    const fileName = basename(relativePath);
    const summaryLine = generateFileSummaryLine("asset", fileName, {
      typeName: parsed.typeName,
    });

    this.store.upsertFile({
      path: relativePath,
      type: "asset",
      content_hash: contentHash,
      modified_at: this.getModifiedTime(join(this.projectRoot, relativePath)),
      indexed_at: new Date().toISOString(),
      summary_line: summaryLine,
      importance_score: 0,
      status: "ok",
    });
  }

  private indexScript(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const scripts = parseScript(content);
    const fileName = basename(relativePath);

    let primarySummaryLine = generateFileSummaryLine("script", fileName, {
      className: "",
      baseClass: "",
      memberCount: 0,
    });
    let primaryImportance = 0;

    for (const script of scripts) {
      const apiSummary = generateApiSummary(script);
      const scriptId = this.store.insertScript({
        file_id: fileId,
        class_name: script.className,
        namespace: script.namespace,
        base_class: script.baseClass,
        interfaces: JSON.stringify(script.interfaces),
        assembly_name: "",
        api_summary: apiSummary,
        complexity_score: script.members.length,
        is_monobehaviour: script.isMonoBehaviour,
        is_editor_script: script.isEditorScript,
        is_scriptable_object: script.isScriptableObject,
        is_generated: script.isGenerated,
      });

      for (const member of script.members) {
        const signature = generateMemberSignature(member);
        this.store.insertScriptMember({
          script_id: scriptId,
          name: member.name,
          kind: member.kind,
          access: member.access,
          return_type: member.returnType,
          parameters: JSON.stringify(member.parameters),
          attributes: JSON.stringify(member.attributes),
          signature,
          has_serialize_field: member.attributes.includes("SerializeField"),
          has_header_attr: member.attributes.includes("Header"),
          start_line: member.startLine,
          end_line: member.endLine,
        });
      }

      // Use the first (or most important) script for the file summary
      if (script === scripts[0]) {
        primarySummaryLine = generateFileSummaryLine("script", fileName, {
          className: script.className,
          baseClass: script.baseClass,
          memberCount: script.members.length,
        });
        primaryImportance = computeFileImportance({
          incomingRefCount: 0,
          outgoingRefCount: 0,
          hasCustomScripts: script.isMonoBehaviour || script.isScriptableObject,
          changeFrequency: 0,
        });
      }

      // Graph edges: DEFINED_IN
      this.insertEdge("script", scriptId, "file", fileId, "DEFINED_IN", fileId);

      // Graph edges: INHERITS (if base_class resolves to a known script)
      if (script.baseClass) {
        const baseScript = this.store.getScriptByClassName(script.baseClass);
        if (baseScript) {
          this.insertEdge("script", scriptId, "script", baseScript.id, "INHERITS", fileId);
        }
      }

      // Graph edges: IMPLEMENTS
      for (const iface of script.interfaces) {
        const ifaceScript = this.store.getScriptByClassName(iface);
        if (ifaceScript) {
          this.insertEdge("script", scriptId, "script", ifaceScript.id, "IMPLEMENTS", fileId);
        }
      }
    }

    this.store.upsertFile({
      path: relativePath,
      type: "script",
      content_hash: contentHash,
      modified_at: this.getModifiedTime(join(this.projectRoot, relativePath)),
      indexed_at: new Date().toISOString(),
      summary_line: primarySummaryLine,
      importance_score: primaryImportance,
      status: "ok",
    });
  }

  /**
   * Second-pass: insert CALLS, SUBSCRIBES_TO, and USES edges for a script file.
   * Must be called after all scripts in the batch have been inserted so that
   * cross-class lookups (getScriptByClassName) succeed regardless of file order.
   */
  private indexScriptCrossEdges(relativePath: string): void {
    const fullPath = join(this.projectRoot, relativePath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      return;
    }

    const fileRow = this.store.getFileByPath(relativePath);
    if (!fileRow) return;
    const fileId = fileRow.id;

    // CALLS and SUBSCRIBES_TO edges
    const relationships = extractRelationships(content);
    for (const rel of relationships) {
      const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
      const targetScript = this.store.getScriptByClassName(rel.targetClassName);
      if (sourceScript && targetScript) {
        this.insertEdge("script", sourceScript.id, "script", targetScript.id, rel.edgeType, fileId);
      }
    }

    // USES edges from field/param/local type references
    const typeRefs = extractTypeReferences(content);
    for (const rel of typeRefs) {
      const sourceScript = this.store.getScriptByClassName(rel.sourceClassName);
      const targetScript = this.store.getScriptByClassName(rel.targetClassName);
      if (sourceScript && targetScript) {
        this.insertEdge("script", sourceScript.id, "script", targetScript.id, rel.edgeType, fileId);
      }
    }
  }

  private indexAsmDef(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const parsed = parseAsmDef(content);

    const depSummary =
      parsed.references.length > 0 ? `refs: ${parsed.references.join(", ")}` : "no references";

    const asmId = this.store.insertAssembly({
      file_id: fileId,
      name: parsed.name,
      references: JSON.stringify(parsed.references),
      defines: JSON.stringify(parsed.defines),
      platforms: JSON.stringify([...parsed.includePlatforms, ...parsed.excludePlatforms]),
      dependency_summary: depSummary,
    });

    this.insertEdge("file", fileId, "assembly", asmId, "BELONGS_TO", fileId);

    // Build lookup map once outside the loop to avoid O(n²) listAssemblies() calls
    const assembliesByName = new Map(this.store.listAssemblies().map((a) => [a.name, a]));
    for (const refName of parsed.references) {
      const targetAsm = assembliesByName.get(refName);
      if (targetAsm) {
        this.insertEdge("assembly", asmId, "assembly", targetAsm.id, "ASSEMBLY_DEPENDS", fileId);
      }
    }

    const fileName = basename(relativePath);
    const summaryLine = generateFileSummaryLine("asmdef", fileName, {
      assemblyName: parsed.name,
    });

    this.store.upsertFile({
      path: relativePath,
      type: "asmdef",
      content_hash: contentHash,
      modified_at: this.getModifiedTime(join(this.projectRoot, relativePath)),
      indexed_at: new Date().toISOString(),
      summary_line: summaryLine,
      importance_score: 0,
      status: "ok",
    });
  }

  // ---------------------------------------------------------------------------
  // Private: GameObject + Component storage
  // ---------------------------------------------------------------------------

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
    const localIdToDbId = new Map<string, number>();

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

      localIdToDbId.set(go.fileIdLocal, goId);

      for (const comp of go.components) {
        const fieldSummary = generateFieldSummary(comp.serializedFields, guidToClass);
        const patternHash = createHash("md5")
          .update(comp.typeName + JSON.stringify(Object.keys(comp.serializedFields).sort()))
          .digest("hex");

        const compId = this.store.insertComponent({
          game_object_id: goId,
          type_name: comp.typeName,
          script_guid: comp.scriptGuid,
          order: comp.order,
          serialized_fields: JSON.stringify(comp.serializedFields),
          field_summary: fieldSummary,
          pattern_hash: patternHash,
        });

        // Graph edge: ATTACHES_TO
        this.insertEdge("component", compId, "game_object", goId, "ATTACHES_TO", fileId);

        // Graph edge: SCRIPTED_BY
        if (comp.scriptGuid !== null) {
          const targetClassName = guidToClass.get(comp.scriptGuid);
          if (targetClassName !== undefined) {
            const scriptRow = this.store.getScriptByClassName(targetClassName);
            if (scriptRow !== undefined) {
              this.insertEdge("component", compId, "script", scriptRow.id, "SCRIPTED_BY", fileId);
            }
          }
        }
      }

      return subtreeDepth;
    };

    for (const root of roots) {
      insertRecursive(root, 0);
    }

    // Graph edges: CHILD_OF
    for (const go of gameObjects) {
      if (go.parentFileIdLocal !== null) {
        const childDbId = localIdToDbId.get(go.fileIdLocal);
        const parentDbId = localIdToDbId.get(go.parentFileIdLocal);
        if (childDbId !== undefined && parentDbId !== undefined) {
          this.insertEdge("game_object", childDbId, "game_object", parentDbId, "CHILD_OF", fileId);
        }
      }
    }
  }

  private storeReferences(fileId: number, references: ParsedGuidReference[]): void {
    for (const ref of references) {
      // Try to resolve the target GUID to a file ID
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

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  private buildGuidToClassMap(): Map<string, string> {
    return this.store.getGuidToClassMap();
  }

  private updateProjectSummary(): void {
    const allFiles = this.store.listFiles();
    const fileCounts: Record<string, number> = {};
    for (const f of allFiles) {
      fileCounts[f.type] = (fileCounts[f.type] ?? 0) + 1;
    }

    const sceneCount = fileCounts["scene"] ?? 0;
    const prefabCount = fileCounts["prefab"] ?? 0;
    const scriptCount = fileCounts["script"] ?? 0;

    const description =
      `Unity project with ${String(sceneCount)} scene${sceneCount !== 1 ? "s" : ""}, ` +
      `${String(prefabCount)} prefab${prefabCount !== 1 ? "s" : ""}, ` +
      `and ${String(scriptCount)} script${scriptCount !== 1 ? "s" : ""}.`;

    // Hot scripts: most-referenced script files
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

    // Assembly structure: dependency graph
    const assemblies = this.store.listAssemblies();
    const assemblyStructure: Record<string, string[]> = {};
    for (const asm of assemblies) {
      assemblyStructure[asm.name] = JSON.parse(asm.references) as string[];
    }

    this.store.updateProjectSummary({
      file_counts: JSON.stringify(fileCounts),
      scene_count: sceneCount,
      prefab_count: prefabCount,
      script_count: scriptCount,
      assembly_structure: JSON.stringify(assemblyStructure),
      hot_scripts: JSON.stringify(hotScripts),
      description,
      indexed_at: new Date().toISOString(),
      root_path: this.projectRoot,
    });
  }

  private collectFiles(): string[] {
    const files: string[] = [];
    const assetsDir = join(this.projectRoot, "Assets");
    const packagesDir = join(this.projectRoot, "Packages");

    try {
      this.walkDir(assetsDir, files);
    } catch {
      // Assets dir may not exist
    }

    try {
      this.walkDir(packagesDir, files);
    } catch {
      // Packages dir is optional
    }

    return files;
  }

  private walkDir(dir: string, files: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, files);
      } else if (stat.isFile()) {
        const relPath = relative(this.projectRoot, fullPath);
        const type = detectFileType(relPath);
        if (type !== null) {
          files.push(relPath);
        }
      }
    }
  }

  private getModifiedTime(fullPath: string): string {
    try {
      return statSync(fullPath).mtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
}
