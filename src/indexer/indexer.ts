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
import { detectFileType } from "../types.js";
import type { ParsedGameObject, ParsedGuidReference } from "../types.js";

function log(msg: string): void {
  console.error(`[unity-indexer] ${msg}`);
}

export class Indexer {
  private guidToClassCache: Map<string, string> | null = null;

  constructor(
    private store: Store,
    private projectRoot: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  indexAll(): void {
    const files = this.collectFiles();
    log(`found ${String(files.length)} files to index`);

    const metaFiles = files.filter((f) => f.endsWith(".meta"));
    const otherFiles = files.filter((f) => !f.endsWith(".meta"));

    // Index meta files first in batches (GUID registry needed by other parsers)
    log(`indexing ${String(metaFiles.length)} meta files...`);
    this.indexBatch(metaFiles);

    // Index scripts before scenes/prefabs so guidToClassMap is populated
    const scripts = otherFiles.filter((f) => f.endsWith(".cs"));
    const asmdefs = otherFiles.filter((f) => f.endsWith(".asmdef"));
    const assets = otherFiles.filter((f) => f.endsWith(".asset"));
    const scenesAndPrefabs = otherFiles.filter(
      (f) => f.endsWith(".unity") || f.endsWith(".prefab"),
    );

    if (scripts.length > 0) {
      log(`indexing ${String(scripts.length)} script files...`);
      this.indexBatch(scripts);
    }
    if (asmdefs.length > 0) {
      log(`indexing ${String(asmdefs.length)} asmdef files...`);
      this.indexBatch(asmdefs);
    }
    if (assets.length > 0) {
      log(`indexing ${String(assets.length)} asset files...`);
      this.indexBatch(assets);
    }

    // Build guid→class map once now that all scripts + metas are indexed
    log("building GUID → class map...");
    this.guidToClassCache = this.buildGuidToClassMap();

    if (scenesAndPrefabs.length > 0) {
      log(`indexing ${String(scenesAndPrefabs.length)} scene/prefab files...`);
      this.indexBatch(scenesAndPrefabs);
    }

    this.guidToClassCache = null;

    log("recomputing reference counts...");
    this.store.recomputeReferenceCounts();
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

  indexFile(relativePath: string): void {
    this.store.transaction(() => {
      this.indexFileInternal(relativePath);
    });
    this.store.recomputeReferenceCounts();
    this.updateProjectSummary();
  }

  removeFile(relativePath: string): void {
    const existing = this.store.getFileByPath(relativePath);
    if (!existing) return;

    this.store.transaction(() => {
      this.store.insertChangeLog({
        file_id: existing.id,
        changed_at: new Date().toISOString(),
        change_type: "deleted",
      });
      this.store.deleteFileData(existing.id);
      this.store.deleteFile(existing.id);
    });

    this.store.recomputeReferenceCounts();
    this.updateProjectSummary();
  }

  // ---------------------------------------------------------------------------
  // Private: Core indexing
  // ---------------------------------------------------------------------------

  private indexFileInternal(relativePath: string): void {
    const fullPath = join(this.projectRoot, relativePath);

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
        modified_at: this.getModifiedTime(fullPath),
        indexed_at: new Date().toISOString(),
        summary_line: basename(relativePath),
        importance_score: 0,
        status: "binary",
      });
      return;
    }

    // Compute content hash
    const contentHash = createHash("sha256").update(content).digest("hex");

    // Check if file changed
    const existing = this.store.getFileByPath(relativePath);
    if (existing && existing.content_hash === contentHash) {
      // Unchanged — skip
      return;
    }

    // Upsert the file row (initially with minimal data)
    const modifiedAt = this.getModifiedTime(fullPath);
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

  private indexAsmDef(
    fileId: number,
    relativePath: string,
    content: string,
    contentHash: string,
  ): void {
    const parsed = parseAsmDef(content);

    const depSummary =
      parsed.references.length > 0 ? `refs: ${parsed.references.join(", ")}` : "no references";

    this.store.insertAssembly({
      file_id: fileId,
      name: parsed.name,
      references: JSON.stringify(parsed.references),
      defines: JSON.stringify(parsed.defines),
      platforms: JSON.stringify([...parsed.includePlatforms, ...parsed.excludePlatforms]),
      dependency_summary: depSummary,
    });

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
    // Build child map: parentFileIdLocal → children
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

    // Compute depth recursively
    const depthMap = new Map<string, number>();

    const computeDepth = (fileIdLocal: string, depth: number) => {
      depthMap.set(fileIdLocal, depth);
      const children = childMap.get(fileIdLocal) ?? [];
      for (const child of children) {
        computeDepth(child.fileIdLocal, depth + 1);
      }
    };

    for (const root of roots) {
      computeDepth(root.fileIdLocal, 0);
    }

    // Compute subtree depth recursively
    const subtreeDepthMap = new Map<string, number>();
    const computeSubtreeDepth = (fileIdLocal: string): number => {
      const children = childMap.get(fileIdLocal) ?? [];
      if (children.length === 0) {
        subtreeDepthMap.set(fileIdLocal, 0);
        return 0;
      }
      const maxChildDepth = Math.max(...children.map((c) => computeSubtreeDepth(c.fileIdLocal)));
      const depth = maxChildDepth + 1;
      subtreeDepthMap.set(fileIdLocal, depth);
      return depth;
    };

    for (const go of gameObjects) {
      if (!subtreeDepthMap.has(go.fileIdLocal)) {
        computeSubtreeDepth(go.fileIdLocal);
      }
    }

    // Insert game objects in topological order (parents before children)
    const siblingIndex = new Map<string, number>();

    const insertGo = (go: ParsedGameObject) => {
      const depth = depthMap.get(go.fileIdLocal) ?? 0;
      const parentKey = go.parentFileIdLocal ?? "__root__";
      const idx = siblingIndex.get(parentKey) ?? 0;
      siblingIndex.set(parentKey, idx + 1);

      const children = childMap.get(go.fileIdLocal) ?? [];
      const childNames = children.map((c) => c.name);
      const subtreeDepth = subtreeDepthMap.get(go.fileIdLocal) ?? 0;
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

      // Insert components
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

      // Recurse into children
      for (const child of children) {
        insertGo(child);
      }
    };

    for (const root of roots) {
      insertGo(root);
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
