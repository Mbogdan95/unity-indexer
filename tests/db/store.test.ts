import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/db/store.js';
import type {
  FileRow,
  GameObjectRow,
  ScriptRow,
  ScriptMemberRow,
  GuidRow,
  ReferenceRow,
} from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    path: 'Assets/Scenes/Main.unity',
    type: 'scene',
    content_hash: 'abc123',
    modified_at: '2024-01-01T00:00:00Z',
    indexed_at: '2024-01-01T00:00:00Z',
    summary_line: 'Main scene',
    importance_score: 0.8,
    status: 'ok',
    ...overrides,
  };
}

function makeGO(fileId: number, overrides: Partial<GameObjectRow> = {}): GameObjectRow {
  return {
    file_id: fileId,
    file_id_local: '100',
    name: 'Player',
    parent_file_id_local: null,
    depth: 0,
    sibling_index: 0,
    active: true,
    layer: 0,
    tag: 'Player',
    component_summary: 'Transform, MonoBehaviour',
    subtree_summary: '',
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
    class_name: 'PlayerController',
    namespace: 'Game',
    base_class: 'MonoBehaviour',
    interfaces: '[]',
    assembly_name: 'Assembly-CSharp',
    api_summary: 'Controls player movement',
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

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

afterEach(() => {
  store.close();
});

// ---------------------------------------------------------------------------
describe('Store - files', () => {
  it('upserts and retrieves a file by path', () => {
    const file = makeFile();
    const id = store.upsertFile(file);
    expect(id).toBeGreaterThan(0);

    const retrieved = store.getFileByPath(file.path);
    expect(retrieved).toBeDefined();
    expect(retrieved!.path).toBe(file.path);
    expect(retrieved!.type).toBe('scene');
    expect(retrieved!.importance_score).toBe(0.8);
    expect(retrieved!.id).toBe(id);
  });

  it('updates an existing file on upsert (same path)', () => {
    const file = makeFile();
    const id1 = store.upsertFile(file);
    const id2 = store.upsertFile({ ...file, summary_line: 'Updated summary', importance_score: 1.0 });

    // Should return the same row id
    expect(id2).toBe(id1);

    const retrieved = store.getFileByPath(file.path);
    expect(retrieved!.summary_line).toBe('Updated summary');
    expect(retrieved!.importance_score).toBe(1.0);
  });

  it('lists files filtered by type, sorted by importance_score DESC', () => {
    store.upsertFile(makeFile({ path: 'a.unity', type: 'scene', importance_score: 0.5 }));
    store.upsertFile(makeFile({ path: 'b.unity', type: 'scene', importance_score: 0.9 }));
    store.upsertFile(makeFile({ path: 'c.cs', type: 'script', importance_score: 0.7 }));

    const scenes = store.listFiles('scene');
    expect(scenes).toHaveLength(2);
    expect(scenes[0].importance_score).toBeGreaterThanOrEqual(scenes[1].importance_score);
    expect(scenes.every(f => f.type === 'scene')).toBe(true);
  });

  it('retrieves a file by id', () => {
    const id = store.upsertFile(makeFile());
    const retrieved = store.getFileById(id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(id);
  });

  it('returns undefined for unknown path', () => {
    expect(store.getFileByPath('does-not-exist.unity')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('Store - game objects', () => {
  it('inserts and retrieves game objects by file', () => {
    const fileId = store.upsertFile(makeFile());
    const goId = store.insertGameObject(makeGO(fileId));
    expect(goId).toBeGreaterThan(0);

    const gos = store.getGameObjectsByFile(fileId);
    expect(gos).toHaveLength(1);
    expect(gos[0].name).toBe('Player');
    expect(gos[0].active).toBe(true);
    expect(gos[0].is_leaf).toBe(true);
    expect(gos[0].id).toBe(goId);
  });

  it('returns empty array for file with no game objects', () => {
    const fileId = store.upsertFile(makeFile());
    expect(store.getGameObjectsByFile(fileId)).toHaveLength(0);
  });

  it('retrieves a game object by name within a file', () => {
    const fileId = store.upsertFile(makeFile());
    store.insertGameObject(makeGO(fileId, { name: 'Enemy' }));

    const found = store.getGameObjectByName(fileId, 'Enemy');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Enemy');
  });
});

// ---------------------------------------------------------------------------
describe('Store - scripts', () => {
  it('inserts and lists scripts', () => {
    const fileId = store.upsertFile(makeFile({ path: 'Assets/Scripts/Player.cs', type: 'script' }));
    store.insertScript(makeScript(fileId));

    const all = store.listScripts();
    expect(all).toHaveLength(1);
    expect(all[0].class_name).toBe('PlayerController');
    expect(all[0].is_monobehaviour).toBe(true);
  });

  it('finds a script by class name', () => {
    const fileId = store.upsertFile(makeFile({ path: 'Assets/Scripts/Player.cs', type: 'script' }));
    store.insertScript(makeScript(fileId));

    const found = store.getScriptByClassName('PlayerController');
    expect(found).toBeDefined();
    expect(found!.namespace).toBe('Game');
    expect(found!.base_class).toBe('MonoBehaviour');
  });

  it('filters scripts by isMonoBehaviour', () => {
    const fileId = store.upsertFile(makeFile({ path: 'p.cs', type: 'script' }));
    store.insertScript(makeScript(fileId, { class_name: 'MyMB', is_monobehaviour: true }));
    store.insertScript(
      makeScript(fileId, { class_name: 'MySO', is_monobehaviour: false, is_scriptable_object: true }),
    );

    const mbs = store.listScripts({ isMonoBehaviour: true });
    expect(mbs).toHaveLength(1);
    expect(mbs[0].class_name).toBe('MyMB');
  });

  it('inserts and retrieves script members', () => {
    const fileId = store.upsertFile(makeFile({ path: 'p.cs', type: 'script' }));
    const scriptId = store.insertScript(makeScript(fileId));

    const member: ScriptMemberRow = {
      script_id: scriptId,
      name: 'Start',
      kind: 'method',
      access: 'private',
      return_type: 'void',
      parameters: '[]',
      attributes: '[]',
      signature: 'void Start()',
      has_serialize_field: false,
      has_header_attr: false,
    };
    store.insertScriptMember(member);

    const members = store.getScriptMembers(scriptId);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('Start');
    expect(members[0].has_serialize_field).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Store - guids', () => {
  it('stores and resolves a guid', () => {
    const fileId = store.upsertFile(makeFile());
    const guidRow: GuidRow = { guid: 'abc-def-123', file_id: fileId, asset_type: 'scene' };
    store.upsertGuid(guidRow);

    const resolved = store.resolveGuid('abc-def-123');
    expect(resolved).toBeDefined();
    expect(resolved!.file_id).toBe(fileId);
    expect(resolved!.asset_type).toBe('scene');
  });

  it('returns undefined for unknown guid', () => {
    expect(store.resolveGuid('nonexistent')).toBeUndefined();
  });

  it('upserts guid without error', () => {
    const fileId = store.upsertFile(makeFile());
    const guidRow: GuidRow = { guid: 'abc-def-123', file_id: fileId, asset_type: 'scene' };
    store.upsertGuid(guidRow);
    // Update the same guid
    store.upsertGuid({ ...guidRow, asset_type: 'prefab' });

    const resolved = store.resolveGuid('abc-def-123');
    expect(resolved!.asset_type).toBe('prefab');
  });

  it('gets guid by file id', () => {
    const fileId = store.upsertFile(makeFile());
    store.upsertGuid({ guid: 'xyz', file_id: fileId, asset_type: 'script' });

    const found = store.getGuidByFileId(fileId);
    expect(found).toBeDefined();
    expect(found!.guid).toBe('xyz');
  });
});

// ---------------------------------------------------------------------------
describe('Store - references', () => {
  it('stores and queries references by target guid', () => {
    const fileId = store.upsertFile(makeFile());
    const ref: ReferenceRow = {
      source_file_id: fileId,
      source_context: 'MonoBehaviour',
      target_guid: 'target-guid-001',
      target_file_id: null,
      ref_type: 'script_attachment',
    };
    store.insertReference(ref);

    const refs = store.getReferencesToGuid('target-guid-001');
    expect(refs).toHaveLength(1);
    expect(refs[0].source_file_id).toBe(fileId);
    expect(refs[0].ref_type).toBe('script_attachment');
  });

  it('queries references from a file', () => {
    const fileId = store.upsertFile(makeFile());
    store.insertReference({
      source_file_id: fileId,
      source_context: 'field',
      target_guid: 'guid-A',
      target_file_id: null,
      ref_type: 'field_reference',
    });
    store.insertReference({
      source_file_id: fileId,
      source_context: 'field',
      target_guid: 'guid-B',
      target_file_id: null,
      ref_type: 'field_reference',
    });

    const refs = store.getReferencesFromFile(fileId);
    expect(refs).toHaveLength(2);
  });

  it('returns empty array for file with no outgoing references', () => {
    const fileId = store.upsertFile(makeFile());
    expect(store.getReferencesFromFile(fileId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('Store - deleteFileData', () => {
  it('cascades deletion of game objects, components, scripts, members, references, guids', () => {
    const fileId = store.upsertFile(makeFile());

    // Game object + component
    const goId = store.insertGameObject(makeGO(fileId));
    store.insertComponent({
      game_object_id: goId,
      type_name: 'Transform',
      script_guid: null,
      order: 0,
      serialized_fields: '{}',
      field_summary: '',
      pattern_hash: '',
    });

    // Script + member
    const scriptId = store.insertScript(makeScript(fileId));
    store.insertScriptMember({
      script_id: scriptId,
      name: 'Awake',
      kind: 'method',
      access: 'private',
      return_type: 'void',
      parameters: '[]',
      attributes: '[]',
      signature: 'void Awake()',
      has_serialize_field: false,
      has_header_attr: false,
    });

    // Guid + reference
    store.upsertGuid({ guid: 'file-guid', file_id: fileId, asset_type: 'scene' });
    store.insertReference({
      source_file_id: fileId,
      source_context: '',
      target_guid: 'some-guid',
      target_file_id: null,
      ref_type: 'field_reference',
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
    expect(store.resolveGuid('file-guid')).toBeUndefined();
    expect(store.getReferencesFromFile(fileId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('Store - project summary', () => {
  it('returns the default project summary row', () => {
    const summary = store.getProjectSummary();
    expect(summary.id).toBe(1);
    expect(summary.scene_count).toBe(0);
  });

  it('updates partial fields of the project summary', () => {
    store.updateProjectSummary({ scene_count: 3, description: 'A test project' });
    const summary = store.getProjectSummary();
    expect(summary.scene_count).toBe(3);
    expect(summary.description).toBe('A test project');
    expect(summary.prefab_count).toBe(0); // unchanged
  });
});

// ---------------------------------------------------------------------------
describe('Store - transactions', () => {
  it('wraps operations in a transaction', () => {
    const result = store.transaction(() => {
      const id = store.upsertFile(makeFile());
      return id;
    });
    expect(result).toBeGreaterThan(0);
    expect(store.getFileByPath('Assets/Scenes/Main.unity')).toBeDefined();
  });
});
