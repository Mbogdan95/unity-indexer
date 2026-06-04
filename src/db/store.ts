import Database, { type Database as DatabaseType } from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";
import type {
  FileRow,
  GameObjectRow,
  ComponentRow,
  ScriptRow,
  ScriptMemberRow,
  GuidRow,
  ReferenceRow,
  AssemblyRow,
  ChangeLogRow,
  ProjectSummaryRow,
} from "../types.js";

// SQLite stores booleans as 0/1; these helpers convert back to JS booleans.
function boolOut(val: unknown): boolean {
  return val === 1 || val === true;
}

function fileRowOut(row: Record<string, unknown>): FileRow & { id: number } {
  return {
    id: row.id as number,
    path: row.path as string,
    type: row.type as FileRow["type"],
    content_hash: row.content_hash as string,
    modified_at: row.modified_at as string,
    indexed_at: row.indexed_at as string,
    summary_line: row.summary_line as string,
    importance_score: row.importance_score as number,
    status: row.status as FileRow["status"],
  };
}

function goRowOut(row: Record<string, unknown>): GameObjectRow & { id: number } {
  return {
    id: row.id as number,
    file_id: row.file_id as number,
    file_id_local: row.file_id_local as string,
    name: row.name as string,
    parent_file_id_local: row.parent_file_id_local as string | null,
    depth: row.depth as number,
    sibling_index: row.sibling_index as number,
    active: boolOut(row.active),
    layer: row.layer as number,
    tag: row.tag as string,
    component_summary: row.component_summary as string,
    subtree_summary: row.subtree_summary as string,
    is_leaf: boolOut(row.is_leaf),
    child_count: row.child_count as number,
    subtree_depth: row.subtree_depth as number,
    importance_score: row.importance_score as number,
  };
}

function scriptRowOut(row: Record<string, unknown>): ScriptRow & { id: number } {
  return {
    id: row.id as number,
    file_id: row.file_id as number,
    class_name: row.class_name as string,
    namespace: row.namespace as string,
    base_class: row.base_class as string,
    interfaces: row.interfaces as string,
    assembly_name: row.assembly_name as string,
    api_summary: row.api_summary as string,
    complexity_score: row.complexity_score as number,
    is_monobehaviour: boolOut(row.is_monobehaviour),
    is_editor_script: boolOut(row.is_editor_script),
    is_scriptable_object: boolOut(row.is_scriptable_object),
    is_generated: boolOut(row.is_generated),
  };
}

function memberRowOut(row: Record<string, unknown>): ScriptMemberRow & { id: number } {
  return {
    id: row.id as number,
    script_id: row.script_id as number,
    name: row.name as string,
    kind: row.kind as string,
    access: row.access as string,
    return_type: row.return_type as string,
    parameters: row.parameters as string,
    attributes: row.attributes as string,
    signature: row.signature as string,
    has_serialize_field: boolOut(row.has_serialize_field),
    has_header_attr: boolOut(row.has_header_attr),
  };
}

export class Store {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  upsertFile(file: FileRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, type, content_hash, modified_at, indexed_at, summary_line, importance_score, status)
      VALUES (@path, @type, @content_hash, @modified_at, @indexed_at, @summary_line, @importance_score, @status)
      ON CONFLICT(path) DO UPDATE SET
        type             = excluded.type,
        content_hash     = excluded.content_hash,
        modified_at      = excluded.modified_at,
        indexed_at       = excluded.indexed_at,
        summary_line     = excluded.summary_line,
        importance_score = excluded.importance_score,
        status           = excluded.status
      RETURNING id
    `);
    const row = stmt.get({
      path: file.path,
      type: file.type,
      content_hash: file.content_hash,
      modified_at: file.modified_at,
      indexed_at: file.indexed_at,
      summary_line: file.summary_line,
      importance_score: file.importance_score,
      status: file.status,
    }) as { id: number };
    return row.id;
  }

  getFileByPath(path: string): (FileRow & { id: number }) | undefined {
    const row = this.db.prepare("SELECT * FROM files WHERE path = ?").get(path) as
      | Record<string, unknown>
      | undefined;
    return row ? fileRowOut(row) : undefined;
  }

  getFileById(id: number): (FileRow & { id: number }) | undefined {
    const row = this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? fileRowOut(row) : undefined;
  }

  listFiles(type?: string): (FileRow & { id: number })[] {
    const rows =
      type !== undefined
        ? (this.db
            .prepare("SELECT * FROM files WHERE type = ? ORDER BY importance_score DESC")
            .all(type) as Record<string, unknown>[])
        : (this.db.prepare("SELECT * FROM files ORDER BY importance_score DESC").all() as Record<
            string,
            unknown
          >[]);
    return rows.map(fileRowOut);
  }

  deleteFile(fileId: number): void {
    this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  }

  // ---------------------------------------------------------------------------
  // Game Objects
  // ---------------------------------------------------------------------------

  insertGameObject(go: GameObjectRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO game_objects
        (file_id, file_id_local, name, parent_file_id_local, depth, sibling_index, active, layer, tag,
         component_summary, subtree_summary, is_leaf, child_count, subtree_depth, importance_score)
      VALUES
        (@file_id, @file_id_local, @name, @parent_file_id_local, @depth, @sibling_index, @active, @layer, @tag,
         @component_summary, @subtree_summary, @is_leaf, @child_count, @subtree_depth, @importance_score)
    `);
    const result = stmt.run({
      file_id: go.file_id,
      file_id_local: go.file_id_local,
      name: go.name,
      parent_file_id_local: go.parent_file_id_local ?? null,
      depth: go.depth,
      sibling_index: go.sibling_index,
      active: go.active ? 1 : 0,
      layer: go.layer,
      tag: go.tag,
      component_summary: go.component_summary,
      subtree_summary: go.subtree_summary,
      is_leaf: go.is_leaf ? 1 : 0,
      child_count: go.child_count,
      subtree_depth: go.subtree_depth,
      importance_score: go.importance_score,
    });
    return result.lastInsertRowid as number;
  }

  getGameObjectsByFile(fileId: number): (GameObjectRow & { id: number })[] {
    const rows = this.db
      .prepare("SELECT * FROM game_objects WHERE file_id = ? ORDER BY depth, sibling_index")
      .all(fileId) as Record<string, unknown>[];
    return rows.map(goRowOut);
  }

  getGameObjectById(id: number): (GameObjectRow & { id: number }) | undefined {
    const row = this.db.prepare("SELECT * FROM game_objects WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? goRowOut(row) : undefined;
  }

  getGameObjectByName(fileId: number, name: string): (GameObjectRow & { id: number }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM game_objects WHERE file_id = ? AND name = ? LIMIT 1")
      .get(fileId, name) as Record<string, unknown> | undefined;
    return row ? goRowOut(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------

  insertComponent(comp: ComponentRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO components
        (game_object_id, type_name, script_guid, "order", serialized_fields, field_summary, pattern_hash)
      VALUES
        (@game_object_id, @type_name, @script_guid, @order, @serialized_fields, @field_summary, @pattern_hash)
    `);
    const result = stmt.run({
      game_object_id: comp.game_object_id,
      type_name: comp.type_name,
      script_guid: comp.script_guid ?? null,
      order: comp.order,
      serialized_fields: comp.serialized_fields,
      field_summary: comp.field_summary,
      pattern_hash: comp.pattern_hash,
    });
    return result.lastInsertRowid as number;
  }

  getComponentsByGameObject(goId: number): (ComponentRow & { id: number })[] {
    const rows = this.db
      .prepare('SELECT * FROM components WHERE game_object_id = ? ORDER BY "order"')
      .all(goId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      game_object_id: row.game_object_id as number,
      type_name: row.type_name as string,
      script_guid: row.script_guid as string | null,
      order: row.order as number,
      serialized_fields: row.serialized_fields as string,
      field_summary: row.field_summary as string,
      pattern_hash: row.pattern_hash as string,
    }));
  }

  getComponentsByScriptGuid(
    scriptGuid: string,
    fileId?: number,
  ): (ComponentRow & { id: number })[] {
    const rows =
      fileId !== undefined
        ? (this.db
            .prepare(
              `SELECT c.* FROM components c
             JOIN game_objects g ON g.id = c.game_object_id
             WHERE c.script_guid = ? AND g.file_id = ?`,
            )
            .all(scriptGuid, fileId) as Record<string, unknown>[])
        : (this.db
            .prepare("SELECT * FROM components WHERE script_guid = ?")
            .all(scriptGuid) as Record<string, unknown>[]);
    return rows.map((row) => ({
      id: row.id as number,
      game_object_id: row.game_object_id as number,
      type_name: row.type_name as string,
      script_guid: row.script_guid as string | null,
      order: row.order as number,
      serialized_fields: row.serialized_fields as string,
      field_summary: row.field_summary as string,
      pattern_hash: row.pattern_hash as string,
    }));
  }

  getComponentsByType(typeName: string, fileId?: number): (ComponentRow & { id: number })[] {
    const rows =
      fileId !== undefined
        ? (this.db
            .prepare(
              `SELECT c.* FROM components c
             JOIN game_objects g ON g.id = c.game_object_id
             WHERE c.type_name = ? AND g.file_id = ?`,
            )
            .all(typeName, fileId) as Record<string, unknown>[])
        : (this.db.prepare("SELECT * FROM components WHERE type_name = ?").all(typeName) as Record<
            string,
            unknown
          >[]);
    return rows.map((row) => ({
      id: row.id as number,
      game_object_id: row.game_object_id as number,
      type_name: row.type_name as string,
      script_guid: row.script_guid as string | null,
      order: row.order as number,
      serialized_fields: row.serialized_fields as string,
      field_summary: row.field_summary as string,
      pattern_hash: row.pattern_hash as string,
    }));
  }

  // ---------------------------------------------------------------------------
  // Scripts
  // ---------------------------------------------------------------------------

  insertScript(script: ScriptRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO scripts
        (file_id, class_name, namespace, base_class, interfaces, assembly_name, api_summary,
         complexity_score, is_monobehaviour, is_editor_script, is_scriptable_object, is_generated)
      VALUES
        (@file_id, @class_name, @namespace, @base_class, @interfaces, @assembly_name, @api_summary,
         @complexity_score, @is_monobehaviour, @is_editor_script, @is_scriptable_object, @is_generated)
    `);
    const result = stmt.run({
      file_id: script.file_id,
      class_name: script.class_name,
      namespace: script.namespace,
      base_class: script.base_class,
      interfaces: script.interfaces,
      assembly_name: script.assembly_name,
      api_summary: script.api_summary,
      complexity_score: script.complexity_score,
      is_monobehaviour: script.is_monobehaviour ? 1 : 0,
      is_editor_script: script.is_editor_script ? 1 : 0,
      is_scriptable_object: script.is_scriptable_object ? 1 : 0,
      is_generated: script.is_generated ? 1 : 0,
    });
    return result.lastInsertRowid as number;
  }

  listScripts(filter?: {
    namespace?: string;
    baseClass?: string;
    assembly?: string;
    isMonoBehaviour?: boolean;
  }): (ScriptRow & { id: number })[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.namespace !== undefined) {
      conditions.push("namespace = ?");
      params.push(filter.namespace);
    }
    if (filter?.baseClass !== undefined) {
      conditions.push("base_class = ?");
      params.push(filter.baseClass);
    }
    if (filter?.assembly !== undefined) {
      conditions.push("assembly_name = ?");
      params.push(filter.assembly);
    }
    if (filter?.isMonoBehaviour !== undefined) {
      conditions.push("is_monobehaviour = ?");
      params.push(filter.isMonoBehaviour ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM scripts ${where} ORDER BY class_name`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(scriptRowOut);
  }

  getScriptByClassName(className: string): (ScriptRow & { id: number }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM scripts WHERE class_name = ? LIMIT 1")
      .get(className) as Record<string, unknown> | undefined;
    return row ? scriptRowOut(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Script Members
  // ---------------------------------------------------------------------------

  insertScriptMember(member: ScriptMemberRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO script_members
        (script_id, name, kind, access, return_type, parameters, attributes, signature,
         has_serialize_field, has_header_attr)
      VALUES
        (@script_id, @name, @kind, @access, @return_type, @parameters, @attributes, @signature,
         @has_serialize_field, @has_header_attr)
    `);
    const result = stmt.run({
      script_id: member.script_id,
      name: member.name,
      kind: member.kind,
      access: member.access,
      return_type: member.return_type,
      parameters: member.parameters,
      attributes: member.attributes,
      signature: member.signature,
      has_serialize_field: member.has_serialize_field ? 1 : 0,
      has_header_attr: member.has_header_attr ? 1 : 0,
    });
    return result.lastInsertRowid as number;
  }

  getScriptMembers(scriptId: number): (ScriptMemberRow & { id: number })[] {
    const rows = this.db
      .prepare("SELECT * FROM script_members WHERE script_id = ?")
      .all(scriptId) as Record<string, unknown>[];
    return rows.map(memberRowOut);
  }

  // ---------------------------------------------------------------------------
  // GUIDs
  // ---------------------------------------------------------------------------

  upsertGuid(guidRow: GuidRow): void {
    this.db
      .prepare(
        `
        INSERT INTO guids (guid, file_id, asset_type)
        VALUES (@guid, @file_id, @asset_type)
        ON CONFLICT(guid) DO UPDATE SET
          file_id    = excluded.file_id,
          asset_type = excluded.asset_type
      `,
      )
      .run({
        guid: guidRow.guid,
        file_id: guidRow.file_id,
        asset_type: guidRow.asset_type,
      });
  }

  resolveGuid(guid: string): GuidRow | undefined {
    const row = this.db.prepare("SELECT * FROM guids WHERE guid = ?").get(guid) as
      | GuidRow
      | undefined;
    return row;
  }

  getGuidByFileId(fileId: number): GuidRow | undefined {
    const row = this.db.prepare("SELECT * FROM guids WHERE file_id = ?").get(fileId) as
      | GuidRow
      | undefined;
    return row;
  }

  // ---------------------------------------------------------------------------
  // References
  // ---------------------------------------------------------------------------

  insertReference(ref: ReferenceRow): void {
    this.db
      .prepare(
        `
        INSERT INTO "references"
          (source_file_id, source_context, target_guid, target_file_id, ref_type)
        VALUES
          (@source_file_id, @source_context, @target_guid, @target_file_id, @ref_type)
      `,
      )
      .run({
        source_file_id: ref.source_file_id,
        source_context: ref.source_context,
        target_guid: ref.target_guid,
        target_file_id: ref.target_file_id ?? null,
        ref_type: ref.ref_type,
      });
  }

  getReferencesToGuid(guid: string): (ReferenceRow & { id: number })[] {
    const rows = this.db
      .prepare('SELECT * FROM "references" WHERE target_guid = ?')
      .all(guid) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      source_file_id: row.source_file_id as number,
      source_context: row.source_context as string,
      target_guid: row.target_guid as string,
      target_file_id: row.target_file_id as number | null,
      ref_type: row.ref_type as string,
    }));
  }

  getReferencesFromFile(fileId: number): (ReferenceRow & { id: number })[] {
    const rows = this.db
      .prepare('SELECT * FROM "references" WHERE source_file_id = ?')
      .all(fileId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      source_file_id: row.source_file_id as number,
      source_context: row.source_context as string,
      target_guid: row.target_guid as string,
      target_file_id: row.target_file_id as number | null,
      ref_type: row.ref_type as string,
    }));
  }

  // ---------------------------------------------------------------------------
  // Assemblies
  // ---------------------------------------------------------------------------

  listAssemblies(): (AssemblyRow & { id: number })[] {
    const rows = this.db.prepare("SELECT * FROM assemblies ORDER BY name").all() as Record<
      string,
      unknown
    >[];
    return rows.map((row) => ({
      id: row.id as number,
      file_id: row.file_id as number,
      name: row.name as string,
      references: row.references as string,
      defines: row.defines as string,
      platforms: row.platforms as string,
      dependency_summary: row.dependency_summary as string,
    }));
  }

  insertAssembly(asm: AssemblyRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO assemblies
        (file_id, name, "references", defines, platforms, dependency_summary)
      VALUES
        (@file_id, @name, @references, @defines, @platforms, @dependency_summary)
    `);
    const result = stmt.run({
      file_id: asm.file_id,
      name: asm.name,
      references: asm.references,
      defines: asm.defines,
      platforms: asm.platforms,
      dependency_summary: asm.dependency_summary,
    });
    return result.lastInsertRowid as number;
  }

  // ---------------------------------------------------------------------------
  // Change Log
  // ---------------------------------------------------------------------------

  insertChangeLog(entry: ChangeLogRow): void {
    this.db
      .prepare(
        `
        INSERT INTO change_log (file_id, changed_at, change_type)
        VALUES (@file_id, @changed_at, @change_type)
      `,
      )
      .run({
        file_id: entry.file_id,
        changed_at: entry.changed_at,
        change_type: entry.change_type,
      });
  }

  getRecentChanges(limit = 50): (ChangeLogRow & { id: number; path: string })[] {
    const rows = this.db
      .prepare(
        `
        SELECT cl.id, cl.file_id, cl.changed_at, cl.change_type, f.path
        FROM change_log cl
        JOIN files f ON f.id = cl.file_id
        ORDER BY cl.changed_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      file_id: row.file_id as number,
      changed_at: row.changed_at as string,
      change_type: row.change_type as ChangeLogRow["change_type"],
      path: row.path as string,
    }));
  }

  // ---------------------------------------------------------------------------
  // Project Summary
  // ---------------------------------------------------------------------------

  getProjectSummary(): ProjectSummaryRow {
    const row = this.db.prepare("SELECT * FROM project_summary WHERE id = 1").get() as Record<
      string,
      unknown
    >;
    return {
      id: row.id as number,
      file_counts: row.file_counts as string,
      scene_count: row.scene_count as number,
      prefab_count: row.prefab_count as number,
      script_count: row.script_count as number,
      assembly_structure: row.assembly_structure as string,
      hot_scripts: row.hot_scripts as string,
      recent_changes: row.recent_changes as string,
      description: row.description as string,
      indexed_at: row.indexed_at as string,
    };
  }

  updateProjectSummary(partial: Partial<Omit<ProjectSummaryRow, "id">>): void {
    const fields = Object.keys(partial) as (keyof typeof partial)[];
    if (fields.length === 0) return;
    const sets = fields.map((f) => `${f} = @${f}`).join(", ");
    this.db.prepare(`UPDATE project_summary SET ${sets} WHERE id = 1`).run(partial);
  }

  // ---------------------------------------------------------------------------
  // Reference Counts
  // ---------------------------------------------------------------------------

  getTopReferencedFiles(limit = 10): { file_id: number; guid: string; incoming_count: number }[] {
    return this.db
      .prepare("SELECT * FROM reference_counts ORDER BY incoming_count DESC LIMIT ?")
      .all(limit) as { file_id: number; guid: string; incoming_count: number }[];
  }

  recomputeReferenceCounts(): void {
    this.db.exec(`
      DELETE FROM reference_counts;

      INSERT INTO reference_counts (file_id, guid, incoming_count, outgoing_count)
      SELECT
        g.file_id,
        g.guid,
        COALESCE(inc.cnt, 0)  AS incoming_count,
        COALESCE(out.cnt, 0)  AS outgoing_count
      FROM guids g
      LEFT JOIN (
        SELECT target_file_id AS file_id, COUNT(*) AS cnt
        FROM "references"
        WHERE target_file_id IS NOT NULL
        GROUP BY target_file_id
      ) inc ON inc.file_id = g.file_id
      LEFT JOIN (
        SELECT source_file_id AS file_id, COUNT(*) AS cnt
        FROM "references"
        GROUP BY source_file_id
      ) out ON out.file_id = g.file_id;
    `);
  }

  // ---------------------------------------------------------------------------
  // Cascade Delete (soft — deletes child data, keeps file row)
  // ---------------------------------------------------------------------------

  deleteFileData(fileId: number): void {
    // Components are deleted via game_objects cascade, but we do it manually
    // in correct order for databases that might not have cascade enabled per query.
    // Because FK cascade is ON, deleting game_objects also removes components.
    // Deleting scripts also removes script_members.
    // Deleting the file itself removes guids, references, assemblies, change_log.
    // This method removes child data WITHOUT deleting the file row itself.
    this.db.transaction(() => {
      // Remove components tied to game objects of this file
      this.db
        .prepare(
          `DELETE FROM components
           WHERE game_object_id IN (SELECT id FROM game_objects WHERE file_id = ?)`,
        )
        .run(fileId);

      this.db.prepare("DELETE FROM game_objects WHERE file_id = ?").run(fileId);

      // Remove script members tied to scripts of this file
      this.db
        .prepare(
          `DELETE FROM script_members
           WHERE script_id IN (SELECT id FROM scripts WHERE file_id = ?)`,
        )
        .run(fileId);

      this.db.prepare("DELETE FROM scripts WHERE file_id = ?").run(fileId);
      this.db.prepare('DELETE FROM "references" WHERE source_file_id = ?').run(fileId);
      this.db.prepare("DELETE FROM guids WHERE file_id = ?").run(fileId);
      this.db.prepare("DELETE FROM assemblies WHERE file_id = ?").run(fileId);
    })();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  search(
    query: string,
    scope?: "files" | "game_objects" | "scripts",
  ): { type: string; id: number; label: string; importance_score: number }[] {
    const like = `%${query}%`;
    const results: { type: string; id: number; label: string; importance_score: number }[] = [];

    if (!scope || scope === "files") {
      const rows = this.db
        .prepare(
          `SELECT id, path AS label, importance_score
           FROM files
           WHERE path LIKE ? OR summary_line LIKE ?
           ORDER BY importance_score DESC
           LIMIT 50`,
        )
        .all(like, like) as { id: number; label: string; importance_score: number }[];
      rows.forEach((r) => results.push({ type: "file", ...r }));
    }

    if (!scope || scope === "game_objects") {
      const rows = this.db
        .prepare(
          `SELECT id, name AS label, importance_score
           FROM game_objects
           WHERE name LIKE ?
           ORDER BY importance_score DESC
           LIMIT 50`,
        )
        .all(like) as { id: number; label: string; importance_score: number }[];
      rows.forEach((r) => results.push({ type: "game_object", ...r }));
    }

    if (!scope || scope === "scripts") {
      const rows = this.db
        .prepare(
          `SELECT id, class_name AS label, complexity_score AS importance_score
           FROM scripts
           WHERE class_name LIKE ?
           ORDER BY complexity_score DESC
           LIMIT 50`,
        )
        .all(like) as { id: number; label: string; importance_score: number }[];
      rows.forEach((r) => results.push({ type: "script", ...r }));
    }

    return results.sort((a, b) => b.importance_score - a.importance_score).slice(0, 50);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
