export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_summary (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  file_counts     TEXT NOT NULL DEFAULT '{}',
  scene_count     INTEGER NOT NULL DEFAULT 0,
  prefab_count    INTEGER NOT NULL DEFAULT 0,
  script_count    INTEGER NOT NULL DEFAULT 0,
  assembly_structure TEXT NOT NULL DEFAULT '{}',
  hot_scripts     TEXT NOT NULL DEFAULT '[]',
  recent_changes  TEXT NOT NULL DEFAULT '[]',
  description     TEXT NOT NULL DEFAULT '',
  indexed_at      TEXT NOT NULL DEFAULT '',
  root_path       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  content_hash    TEXT NOT NULL DEFAULT '',
  modified_at     TEXT NOT NULL DEFAULT '',
  indexed_at      TEXT NOT NULL DEFAULT '',
  summary_line    TEXT NOT NULL DEFAULT '',
  importance_score REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ok',
  source_prefab_guid TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_type_importance
  ON files (type, importance_score DESC);

CREATE TABLE IF NOT EXISTS game_objects (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_id_local       TEXT NOT NULL,
  name                TEXT NOT NULL,
  parent_file_id_local TEXT,
  depth               INTEGER NOT NULL DEFAULT 0,
  sibling_index       INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  layer               INTEGER NOT NULL DEFAULT 0,
  tag                 TEXT NOT NULL DEFAULT 'Untagged',
  component_summary   TEXT NOT NULL DEFAULT '',
  subtree_summary     TEXT NOT NULL DEFAULT '',
  is_leaf             INTEGER NOT NULL DEFAULT 1,
  child_count         INTEGER NOT NULL DEFAULT 0,
  subtree_depth       INTEGER NOT NULL DEFAULT 0,
  importance_score    REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_game_objects_file_depth_importance
  ON game_objects (file_id, depth, importance_score DESC);

CREATE INDEX IF NOT EXISTS idx_game_objects_name
  ON game_objects (name);

CREATE INDEX IF NOT EXISTS idx_game_objects_tag
  ON game_objects (tag);

CREATE TABLE IF NOT EXISTS components (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  game_object_id  INTEGER NOT NULL REFERENCES game_objects(id) ON DELETE CASCADE,
  type_name       TEXT NOT NULL,
  script_guid     TEXT,
  "order"         INTEGER NOT NULL DEFAULT 0,
  serialized_fields TEXT NOT NULL DEFAULT '{}',
  field_summary   TEXT NOT NULL DEFAULT '',
  pattern_hash    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_components_game_object_id
  ON components (game_object_id);

CREATE INDEX IF NOT EXISTS idx_components_type_name
  ON components (type_name);

CREATE INDEX IF NOT EXISTS idx_components_script_guid
  ON components (script_guid);

CREATE TABLE IF NOT EXISTS scripts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  class_name          TEXT NOT NULL,
  namespace           TEXT NOT NULL DEFAULT '',
  base_class          TEXT NOT NULL DEFAULT '',
  interfaces          TEXT NOT NULL DEFAULT '[]',
  assembly_name       TEXT NOT NULL DEFAULT '',
  api_summary         TEXT NOT NULL DEFAULT '',
  complexity_score    REAL NOT NULL DEFAULT 0,
  is_monobehaviour    INTEGER NOT NULL DEFAULT 0,
  is_editor_script    INTEGER NOT NULL DEFAULT 0,
  is_scriptable_object INTEGER NOT NULL DEFAULT 0,
  is_generated        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scripts_class_name
  ON scripts (class_name);

CREATE INDEX IF NOT EXISTS idx_scripts_base_class
  ON scripts (base_class);

CREATE INDEX IF NOT EXISTS idx_scripts_assembly_name
  ON scripts (assembly_name);

CREATE INDEX IF NOT EXISTS idx_scripts_file_id
  ON scripts (file_id);

CREATE TABLE IF NOT EXISTS script_members (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id           INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL,
  access              TEXT NOT NULL DEFAULT 'public',
  return_type         TEXT NOT NULL DEFAULT '',
  parameters          TEXT NOT NULL DEFAULT '[]',
  attributes          TEXT NOT NULL DEFAULT '[]',
  signature           TEXT NOT NULL DEFAULT '',
  has_serialize_field INTEGER NOT NULL DEFAULT 0,
  has_header_attr     INTEGER NOT NULL DEFAULT 0,
  start_line          INTEGER NOT NULL DEFAULT 0,
  end_line            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_script_members_script_id
  ON script_members (script_id);

CREATE TABLE IF NOT EXISTS guids (
  guid        TEXT PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  asset_type  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_guids_file_id
  ON guids (file_id);

CREATE TABLE IF NOT EXISTS "references" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source_context  TEXT NOT NULL DEFAULT '',
  target_guid     TEXT NOT NULL,
  target_file_id  INTEGER REFERENCES files(id) ON DELETE SET NULL,
  ref_type        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_references_source_file_id
  ON "references" (source_file_id);

CREATE INDEX IF NOT EXISTS idx_references_target_guid
  ON "references" (target_guid);

CREATE INDEX IF NOT EXISTS idx_references_target_file_id
  ON "references" (target_file_id);

CREATE TABLE IF NOT EXISTS reference_counts (
  file_id         INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  guid            TEXT NOT NULL DEFAULT '',
  incoming_count  INTEGER NOT NULL DEFAULT 0,
  outgoing_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assemblies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  "references"        TEXT NOT NULL DEFAULT '[]',
  defines             TEXT NOT NULL DEFAULT '[]',
  platforms           TEXT NOT NULL DEFAULT '[]',
  dependency_summary  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  changed_at  TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL DEFAULT 'modified'
);

CREATE INDEX IF NOT EXISTS idx_change_log_changed_at
  ON change_log (changed_at DESC);

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

INSERT OR IGNORE INTO project_summary (id) VALUES (1);
`;
//# sourceMappingURL=schema.js.map