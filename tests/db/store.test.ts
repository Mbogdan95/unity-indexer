import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { join } from "path";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import type {
  FileRow,
  GameObjectRow,
  ScriptRow,
  ScriptMemberRow,
  GuidRow,
  ReferenceRow,
  GraphEdgeRow,
} from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    path: "Assets/Scenes/Main.unity",
    type: "scene",
    content_hash: "abc123",
    modified_at: "2024-01-01T00:00:00Z",
    indexed_at: "2024-01-01T00:00:00Z",
    summary_line: "Main scene",
    importance_score: 0.8,
    status: "ok",
    ...overrides,
  };
}

function makeGO(fileId: number, overrides: Partial<GameObjectRow> = {}): GameObjectRow {
  return {
    file_id: fileId,
    file_id_local: "100",
    name: "Player",
    parent_file_id_local: null,
    depth: 0,
    sibling_index: 0,
    active: true,
    layer: 0,
    tag: "Player",
    component_summary: "Transform, MonoBehaviour",
    subtree_summary: "",
    is_leaf: true,
    child_count: 0,
    subtree_depth: 0,
    importance_score: 0.9,
    ...overrides,
  };
}

function makeScript(fileId: number, overrides: Partial<ScriptRow> = {}): ScriptRow {
  return {
    file_id: fileId,
    class_name: "PlayerController",
    namespace: "Game",
    base_class: "MonoBehaviour",
    interfaces: "[]",
    assembly_name: "Assembly-CSharp",
    api_summary: "Controls player movement",
    complexity_score: 5,
    is_monobehaviour: true,
    is_editor_script: false,
    is_scriptable_object: false,
    is_generated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject");

let store: Store;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(":memory:");
});

afterEach(() => {
  store.close();
});

// ---------------------------------------------------------------------------
describe("Store - files", () => {
  it("upserts and retrieves a file by path", () => {
    const file = makeFile();
    const id = store.upsertFile(file);
    expect(id).toBeGreaterThan(0);

    const retrieved = store.getFileByPath(file.path);
    expect(retrieved).toBeDefined();
    expect(retrieved!.path).toBe(file.path);
    expect(retrieved!.type).toBe("scene");
    expect(retrieved!.importance_score).toBe(0.8);
    expect(retrieved!.id).toBe(id);
  });

  it("updates an existing file on upsert (same path)", () => {
    const file = makeFile();
    const id1 = store.upsertFile(file);
    const id2 = store.upsertFile({
      ...file,
      summary_line: "Updated summary",
      importance_score: 1.0,
    });

    // Should return the same row id
    expect(id2).toBe(id1);

    const retrieved = store.getFileByPath(file.path);
    expect(retrieved!.summary_line).toBe("Updated summary");
    expect(retrieved!.importance_score).toBe(1.0);
  });

  it("lists files filtered by type, sorted by importance_score DESC", () => {
    store.upsertFile(makeFile({ path: "a.unity", type: "scene", importance_score: 0.5 }));
    store.upsertFile(makeFile({ path: "b.unity", type: "scene", importance_score: 0.9 }));
    store.upsertFile(makeFile({ path: "c.cs", type: "script", importance_score: 0.7 }));

    const scenes = store.listFiles("scene");
    expect(scenes).toHaveLength(2);
    expect(scenes[0].importance_score).toBeGreaterThanOrEqual(scenes[1].importance_score);
    expect(scenes.every((f) => f.type === "scene")).toBe(true);
  });

  it("retrieves a file by id", () => {
    const id = store.upsertFile(makeFile());
    const retrieved = store.getFileById(id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(id);
  });

  it("returns undefined for unknown path", () => {
    expect(store.getFileByPath("does-not-exist.unity")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("Store - game objects", () => {
  it("inserts and retrieves game objects by file", () => {
    const fileId = store.upsertFile(makeFile());
    const goId = store.insertGameObject(makeGO(fileId));
    expect(goId).toBeGreaterThan(0);

    const gos = store.getGameObjectsByFile(fileId);
    expect(gos).toHaveLength(1);
    expect(gos[0].name).toBe("Player");
    expect(gos[0].active).toBe(true);
    expect(gos[0].is_leaf).toBe(true);
    expect(gos[0].id).toBe(goId);
  });

  it("returns empty array for file with no game objects", () => {
    const fileId = store.upsertFile(makeFile());
    expect(store.getGameObjectsByFile(fileId)).toHaveLength(0);
  });

  it("retrieves a game object by name within a file", () => {
    const fileId = store.upsertFile(makeFile());
    store.insertGameObject(makeGO(fileId, { name: "Enemy" }));

    const found = store.getGameObjectByName(fileId, "Enemy");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Enemy");
  });
});

// ---------------------------------------------------------------------------
describe("Store - scripts", () => {
  it("inserts and lists scripts", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scripts/Player.cs", type: "script" }));
    store.insertScript(makeScript(fileId));

    const all = store.listScripts();
    expect(all).toHaveLength(1);
    expect(all[0].class_name).toBe("PlayerController");
    expect(all[0].is_monobehaviour).toBe(true);
  });

  it("finds a script by class name", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scripts/Player.cs", type: "script" }));
    store.insertScript(makeScript(fileId));

    const found = store.getScriptByClassName("PlayerController");
    expect(found).toBeDefined();
    expect(found!.namespace).toBe("Game");
    expect(found!.base_class).toBe("MonoBehaviour");
  });

  it("filters scripts by isMonoBehaviour", () => {
    const fileId = store.upsertFile(makeFile({ path: "p.cs", type: "script" }));
    store.insertScript(makeScript(fileId, { class_name: "MyMB", is_monobehaviour: true }));
    store.insertScript(
      makeScript(fileId, {
        class_name: "MySO",
        is_monobehaviour: false,
        is_scriptable_object: true,
      }),
    );

    const mbs = store.listScripts({ isMonoBehaviour: true });
    expect(mbs).toHaveLength(1);
    expect(mbs[0].class_name).toBe("MyMB");
  });

  it("finds a script by file_id", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scripts/Test.cs", type: "script" }));
    store.insertScript(makeScript(fileId, { class_name: "TestClass" }));

    const found = store.getScriptByFileId(fileId);
    expect(found).toBeDefined();
    expect(found!.class_name).toBe("TestClass");
  });

  it("returns undefined when no script for file_id", () => {
    const fileId = store.upsertFile(makeFile({ path: "Assets/Scenes/X.unity", type: "scene" }));
    expect(store.getScriptByFileId(fileId)).toBeUndefined();
  });

  it("getScriptById returns script row", () => {
    const indexer = new Indexer(store, FIXTURES);
    indexer.indexAll();
    const pc = store.getScriptByClassName("PlayerController");
    expect(pc).toBeDefined();
    const byId = store.getScriptById(pc!.id);
    expect(byId).toBeDefined();
    expect(byId!.class_name).toBe("PlayerController");
  });

  it("inserts and retrieves script members", () => {
    const fileId = store.upsertFile(makeFile({ path: "p.cs", type: "script" }));
    const scriptId = store.insertScript(makeScript(fileId));

    const member: ScriptMemberRow = {
      script_id: scriptId,
      name: "Start",
      kind: "method",
      access: "private",
      return_type: "void",
      parameters: "[]",
      attributes: "[]",
      signature: "void Start()",
      has_serialize_field: false,
      has_header_attr: false,
      start_line: 0,
      end_line: 0,
    };
    store.insertScriptMember(member);

    const members = store.getScriptMembers(scriptId);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("Start");
    expect(members[0].has_serialize_field).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Store - guids", () => {
  it("stores and resolves a guid", () => {
    const fileId = store.upsertFile(makeFile());
    const guidRow: GuidRow = { guid: "abc-def-123", file_id: fileId, asset_type: "scene" };
    store.upsertGuid(guidRow);

    const resolved = store.resolveGuid("abc-def-123");
    expect(resolved).toBeDefined();
    expect(resolved!.file_id).toBe(fileId);
    expect(resolved!.asset_type).toBe("scene");
  });

  it("returns undefined for unknown guid", () => {
    expect(store.resolveGuid("nonexistent")).toBeUndefined();
  });

  it("upserts guid without error", () => {
    const fileId = store.upsertFile(makeFile());
    const guidRow: GuidRow = { guid: "abc-def-123", file_id: fileId, asset_type: "scene" };
    store.upsertGuid(guidRow);
    // Update the same guid
    store.upsertGuid({ ...guidRow, asset_type: "prefab" });

    const resolved = store.resolveGuid("abc-def-123");
    expect(resolved!.asset_type).toBe("prefab");
  });

  it("gets guid by file id", () => {
    const fileId = store.upsertFile(makeFile());
    store.upsertGuid({ guid: "xyz", file_id: fileId, asset_type: "script" });

    const found = store.getGuidByFileId(fileId);
    expect(found).toBeDefined();
    expect(found!.guid).toBe("xyz");
  });
});

// ---------------------------------------------------------------------------
describe("getGuidToClassMap", () => {
  it("maps script GUID to class name for MonoBehaviours", () => {
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

// ---------------------------------------------------------------------------
describe("Store - references", () => {
  it("stores and queries references by target guid", () => {
    const fileId = store.upsertFile(makeFile());
    const ref: ReferenceRow = {
      source_file_id: fileId,
      source_context: "MonoBehaviour",
      target_guid: "target-guid-001",
      target_file_id: null,
      ref_type: "script_attachment",
    };
    store.insertReference(ref);

    const refs = store.getReferencesToGuid("target-guid-001");
    expect(refs).toHaveLength(1);
    expect(refs[0].source_file_id).toBe(fileId);
    expect(refs[0].ref_type).toBe("script_attachment");
  });

  it("queries references from a file", () => {
    const fileId = store.upsertFile(makeFile());
    store.insertReference({
      source_file_id: fileId,
      source_context: "field",
      target_guid: "guid-A",
      target_file_id: null,
      ref_type: "field_reference",
    });
    store.insertReference({
      source_file_id: fileId,
      source_context: "field",
      target_guid: "guid-B",
      target_file_id: null,
      ref_type: "field_reference",
    });

    const refs = store.getReferencesFromFile(fileId);
    expect(refs).toHaveLength(2);
  });

  it("returns empty array for file with no outgoing references", () => {
    const fileId = store.upsertFile(makeFile());
    expect(store.getReferencesFromFile(fileId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("Store - deleteFileData", () => {
  it("cascades deletion of game objects, components, scripts, members, references, guids", () => {
    const fileId = store.upsertFile(makeFile());

    // Game object + component
    const goId = store.insertGameObject(makeGO(fileId));
    store.insertComponent({
      game_object_id: goId,
      type_name: "Transform",
      script_guid: null,
      order: 0,
      serialized_fields: "{}",
      field_summary: "",
      pattern_hash: "",
    });

    // Script + member
    const scriptId = store.insertScript(makeScript(fileId));
    store.insertScriptMember({
      script_id: scriptId,
      name: "Awake",
      kind: "method",
      access: "private",
      return_type: "void",
      parameters: "[]",
      attributes: "[]",
      signature: "void Awake()",
      has_serialize_field: false,
      has_header_attr: false,
      start_line: 0,
      end_line: 0,
    });

    // Guid + reference
    store.upsertGuid({ guid: "file-guid", file_id: fileId, asset_type: "scene" });
    store.insertReference({
      source_file_id: fileId,
      source_context: "",
      target_guid: "some-guid",
      target_file_id: null,
      ref_type: "field_reference",
    });

    // Now delete child data
    store.deleteFileData(fileId);

    // File row should still exist
    expect(store.getFileById(fileId)).toBeDefined();

    // But children should be gone
    expect(store.getGameObjectsByFile(fileId)).toHaveLength(0);
    expect(store.getComponentsByGameObject(goId)).toHaveLength(0);
    expect(store.listScripts()).toHaveLength(0);
    expect(store.getScriptMembers(scriptId)).toHaveLength(0);
    expect(store.resolveGuid("file-guid")).toBeUndefined();
    expect(store.getReferencesFromFile(fileId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("Store - project summary", () => {
  it("returns the default project summary row", () => {
    const summary = store.getProjectSummary();
    expect(summary.id).toBe(1);
    expect(summary.scene_count).toBe(0);
  });

  it("updates partial fields of the project summary", () => {
    store.updateProjectSummary({ scene_count: 3, description: "A test project" });
    const summary = store.getProjectSummary();
    expect(summary.scene_count).toBe(3);
    expect(summary.description).toBe("A test project");
    expect(summary.prefab_count).toBe(0); // unchanged
  });
});

// ---------------------------------------------------------------------------
describe("Store - transactions", () => {
  it("wraps operations in a transaction", () => {
    const result = store.transaction(() => {
      const id = store.upsertFile(makeFile());
      return id;
    });
    expect(result).toBeGreaterThan(0);
    expect(store.getFileByPath("Assets/Scenes/Main.unity")).toBeDefined();
  });
});

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

    const edge: GraphEdgeRow = {
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
