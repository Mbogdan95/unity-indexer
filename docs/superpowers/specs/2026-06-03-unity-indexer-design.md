# Unity Indexer — Design Spec

A Unity-specialized MCP server that indexes Unity project files into a SQLite database, enabling LLM agents (Claude Code) to explore Unity codebases with minimal token usage.

## Goals

- Reduce token consumption for Unity code exploration by 10-50x vs reading raw files
- Provide progressive-disclosure queries: broad orientation first, drill-down on demand
- Support projects from indie (~100 files) to enterprise (5000+ files)
- Live file watching with incremental index updates

## Architecture

Four layers, strict separation of concerns:

```
┌─────────────────────────────────┐
│  MCP Server (tools/resources)   │  ← Claude Code interface
├─────────────────────────────────┤
│  Query Engine                   │  ← MCP calls → SQL
├─────────────────────────────────┤
│  Index Store (SQLite)           │  ← persistent structured index
├─────────────────────────────────┤
│  Parser Pipeline                │  ← file watchers + parsers
│  ├─ Scene Parser (.unity)       │
│  ├─ Prefab Parser (.prefab)     │
│  ├─ Asset Parser (.asset)       │
│  ├─ Script Parser (.cs)         │
│  ├─ Meta Parser (.meta)         │
│  └─ AsmDef Parser (.asmdef)     │
└─────────────────────────────────┘
```

**Data flow:** File watcher detects change → parser extracts structured data → upserts into SQLite → summaries recomputed → MCP tools query on demand.

Each parser is a pure function: `(filePath, content) → structured records`. No parser knows about SQLite or MCP.

## Technology

- **Language:** TypeScript (Node.js)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** SQLite via `better-sqlite3` (synchronous, single-file, WAL mode)
- **C# parsing:** tree-sitter with C# grammar (signatures only, not method bodies)
- **YAML parsing:** Custom parser for Unity's non-standard tagged YAML (`!u!` tags, `stripped` markers)
- **File watching:** `chokidar` with 500ms debounce

## SQLite Schema

### Design Principles

1. **Pre-computed summaries at every level** — project → scene → hierarchy → component. Agent reads summaries first, drills down only if needed.
2. **Importance scoring** — rank entities by: reference count, has custom scripts, change frequency, hierarchy depth. Surface important stuff first.
3. **Compact text representations** — store pre-rendered one-line summaries alongside structured data. MCP returns these directly.
4. **Default-value filtering** — strip known default values from serialized component fields. Cuts component data 60-80%.
5. **Pre-computed reverse index** — "what uses X?" is a single indexed query, not a scan.

### Tables

#### `project_summary`

Single row, regenerated on each index pass.

| Column             | Type       | Description                        |
| ------------------ | ---------- | ---------------------------------- |
| id                 | INTEGER PK | Always 1                           |
| file_counts        | JSON       | Counts by file type                |
| scene_count        | INTEGER    | Total scenes                       |
| prefab_count       | INTEGER    | Total prefabs                      |
| script_count       | INTEGER    | Total scripts                      |
| assembly_structure | JSON       | Top-level assembly graph           |
| hot_scripts        | JSON       | Most-referenced scripts            |
| recent_changes     | JSON       | Recently modified files            |
| description        | TEXT       | Auto-generated project description |
| indexed_at         | TEXT       | Last full index timestamp          |

~200 tokens. Agent reads this first to orient.

#### `files`

| Column           | Type        | Description                                 |
| ---------------- | ----------- | ------------------------------------------- |
| id               | INTEGER PK  |                                             |
| path             | TEXT UNIQUE | Relative to project root                    |
| type             | TEXT        | scene/prefab/script/asset/meta/asmdef       |
| content_hash     | TEXT        | For incremental update detection            |
| modified_at      | TEXT        | File modification time                      |
| indexed_at       | TEXT        | Last index time                             |
| summary_line     | TEXT        | Pre-rendered one-liner                      |
| importance_score | REAL        | Computed: ref count + scripts + change freq |
| status           | TEXT        | ok/partial/binary/error                     |

Indexes: `(type, importance_score DESC)`, `(path)`.

#### `game_objects`

| Column               | Type       | Description                                              |
| -------------------- | ---------- | -------------------------------------------------------- |
| id                   | INTEGER PK |                                                          |
| file_id              | INTEGER FK | → files                                                  |
| file_id_local        | TEXT       | Unity's fileID within the file                           |
| name                 | TEXT       | GameObject name                                          |
| parent_file_id_local | TEXT       | Parent's fileID (hierarchy)                              |
| depth                | INTEGER    | Hierarchy depth (0 = root)                               |
| sibling_index        | INTEGER    | Order among siblings                                     |
| active               | BOOLEAN    | Is active                                                |
| layer                | INTEGER    | Unity layer                                              |
| tag                  | TEXT       | Unity tag                                                |
| component_summary    | TEXT       | Pre-rendered: "Transform, Rigidbody2D, PlayerController" |
| subtree_summary      | TEXT       | Pre-rendered: "Player [5 children: Sprite, HitBox, ...]" |
| is_leaf              | BOOLEAN    | No children                                              |
| child_count          | INTEGER    | Direct children                                          |
| subtree_depth        | INTEGER    | Max depth below this node                                |
| importance_score     | REAL       | Has MonoBehaviours? Referenced? Deep subtree?            |

Indexes: `(file_id, depth, importance_score DESC)`, `(name)`, `(tag)`.

#### `components`

| Column            | Type       | Description                                                    |
| ----------------- | ---------- | -------------------------------------------------------------- |
| id                | INTEGER PK |                                                                |
| game_object_id    | INTEGER FK | → game_objects                                                 |
| type_name         | TEXT       | Transform, Rigidbody2D, MonoBehaviour, etc.                    |
| script_guid       | TEXT       | GUID if MonoBehaviour (nullable)                               |
| order             | INTEGER    | Component order on GameObject                                  |
| serialized_fields | JSON       | Non-default values only                                        |
| field_summary     | TEXT       | Pre-rendered: "speed=5.5, health=100, weapon=ref:Sword.prefab" |
| pattern_hash      | TEXT       | Hash of type + non-default fields (deduplication)              |

Indexes: `(game_object_id)`, `(type_name)`, `(script_guid)`, `(pattern_hash)`.

#### `scripts`

One row per class/struct/interface/enum declaration (a single .cs file may contain multiple).

| Column               | Type       | Description                         |
| -------------------- | ---------- | ----------------------------------- |
| id                   | INTEGER PK |                                     |
| file_id              | INTEGER FK | → files                             |
| class_name           | TEXT       |                                     |
| namespace            | TEXT       |                                     |
| base_class           | TEXT       |                                     |
| interfaces           | JSON       | Array of interface names            |
| assembly_name        | TEXT       | From asmdef resolution              |
| api_summary          | TEXT       | Pre-rendered compact API surface    |
| complexity_score     | REAL       | LOC, member count, dependency count |
| is_monobehaviour     | BOOLEAN    |                                     |
| is_editor_script     | BOOLEAN    |                                     |
| is_scriptable_object | BOOLEAN    |                                     |
| is_generated         | BOOLEAN    | Detected generated code             |

Indexes: `(class_name)`, `(base_class)`, `(assembly_name)`, `(is_monobehaviour)`.

#### `script_members`

| Column              | Type       | Description                                        |
| ------------------- | ---------- | -------------------------------------------------- |
| id                  | INTEGER PK |                                                    |
| script_id           | INTEGER FK | → scripts                                          |
| name                | TEXT       |                                                    |
| kind                | TEXT       | method/field/property/event                        |
| access              | TEXT       | public/private/protected/internal                  |
| return_type         | TEXT       |                                                    |
| parameters          | JSON       | Array of {name, type}                              |
| attributes          | JSON       | Array of attribute names                           |
| signature           | TEXT       | Pre-rendered: "public void TakeDamage(int amount)" |
| has_serialize_field | BOOLEAN    |                                                    |
| has_header_attr     | BOOLEAN    |                                                    |

Indexes: `(script_id)`, `(kind, access)`.

#### `guids`

| Column     | Type       | Description                               |
| ---------- | ---------- | ----------------------------------------- |
| guid       | TEXT PK    | The GUID from .meta file                  |
| file_id    | INTEGER FK | → files                                   |
| asset_type | TEXT       | script/texture/prefab/scene/material/etc. |

#### `references`

| Column         | Type       | Description                                                          |
| -------------- | ---------- | -------------------------------------------------------------------- |
| id             | INTEGER PK |                                                                      |
| source_file_id | INTEGER FK | → files                                                              |
| source_context | TEXT       | Which field/component contains the reference                         |
| target_guid    | TEXT       | Referenced GUID                                                      |
| target_file_id | INTEGER FK | → files (resolved, nullable)                                         |
| ref_type       | TEXT       | script_attachment/field_reference/prefab_variant/assembly_dependency |

Indexes: `(source_file_id)`, `(target_guid)`, `(target_file_id)`, `(ref_type)`.

#### `reference_counts`

Materialized view, recomputed after index updates.

| Column         | Type       | Description                     |
| -------------- | ---------- | ------------------------------- |
| file_id        | INTEGER FK | → files                         |
| guid           | TEXT       |                                 |
| incoming_count | INTEGER    | How many things reference this  |
| outgoing_count | INTEGER    | How many things this references |

#### `assemblies`

| Column             | Type       | Description                                        |
| ------------------ | ---------- | -------------------------------------------------- |
| id                 | INTEGER PK |                                                    |
| file_id            | INTEGER FK | → files                                            |
| name               | TEXT       | Assembly name                                      |
| references         | JSON       | Referenced assembly names                          |
| defines            | JSON       | Define constraints                                 |
| platforms          | JSON       | Platform include/exclude                           |
| dependency_summary | TEXT       | Pre-rendered: "GameLogic → Core, ThirdParty.Utils" |

#### `change_log`

| Column      | Type       | Description            |
| ----------- | ---------- | ---------------------- |
| id          | INTEGER PK |                        |
| file_id     | INTEGER FK | → files                |
| changed_at  | TEXT       | Timestamp              |
| change_type | TEXT       | added/modified/deleted |

### Token Cost by Query Level

| Level                          | What you get                                 | ~Tokens        |
| ------------------------------ | -------------------------------------------- | -------------- |
| Project summary                | Full project orientation                     | ~200           |
| File listing (important first) | All files, one line each                     | ~500-2000      |
| Scene hierarchy (summaries)    | GameObject tree with component summaries     | ~300-800/scene |
| Single GameObject detail       | Full component data, non-default fields only | ~50-200        |
| Script API summary             | Class signature + all members compact        | ~100-300       |
| Script member detail           | Full signatures + attributes                 | ~20-50/member  |
| Cross-references for entity    | All incoming/outgoing refs                   | ~50-200        |

## Parser Pipeline

### Scene Parser (.unity)

Unity's YAML uses non-standard tagged format (`!u!` type tags, `stripped` markers). Parser:

- Extracts GameObject hierarchy from Transform `m_Father` references
- Resolves component types from `!u!` tag numbers
- Filters serialized field values against default-values table (ships with known defaults for built-in components)
- Extracts GUID references from `m_Script`, `m_PrefabInstance`, any `{fileID: X, guid: Y}` pattern
- Generates `subtree_summary` and `component_summary` strings
- Streams YAML documents for large scenes (50K+ lines) instead of loading entirely

### Prefab Parser (.prefab)

Same YAML format as scenes, plus:

- Prefab variant detection (`m_SourcePrefab` reference)
- Modification records (what the variant overrides)
- Nested prefab references
- Full variant chain resolution

### Asset Parser (.asset)

ScriptableObjects and other serialized assets:

- Type from `!u!` tag or `m_Script` GUID
- All serialized fields, default-filtered
- GUID references extracted

### Script Parser (.cs)

Tree-sitter with C# grammar. Extracts signatures only, not method bodies:

- Class/struct/interface/enum declarations, inheritance, interfaces
- All members with signatures, access modifiers, attributes
- `[SerializeField]`, `[Header]`, `[Tooltip]` extracted specifically (Inspector-relevant)
- Generates `api_summary` compact text
- Detects generated code markers (auto-generated header comments, known tool patterns)

### Meta Parser (.meta)

- GUID → file path mapping
- Importer settings (stored, low priority for queries)

### AsmDef Parser (.asmdef)

- JSON format, trivial parse
- Assembly name, references, defines, platform filters

### File Watcher

- `chokidar` watching `Assets/` and `Packages/` directories
- 500ms debounce (Unity writes files in bursts)
- Hash-check before parsing (skip unchanged files)
- Bulk change detection: >50 files in 2s window → full re-index instead of incremental
- Summary regeneration coalesced over 2s window
- Cascade deletion when files removed

### Initial Index

- Full directory walk on first run
- Parallel parsing via worker threads
- Bulk SQLite insert in transactions per batch
- Summary generation after bulk load
- Progress reporting via MCP notifications

## MCP Interface

### Resources

| URI                       | Description                           | ~Tokens   |
| ------------------------- | ------------------------------------- | --------- |
| `unity://project/summary` | Project summary, read first           | ~200      |
| `unity://project/files`   | File listing by importance, paginated | ~500-2000 |

### Tools

#### Orientation

| Tool                   | Parameters                                               | Returns                                       |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `get_scene_hierarchy`  | scene, depth?, filter? (name/tag/layer)                  | GameObject tree with subtree_summary per root |
| `get_prefab_structure` | prefab                                                   | Same as scene hierarchy for a prefab          |
| `list_scripts`         | filter? (namespace/base_class/assembly/is_monobehaviour) | Scripts sorted by importance with api_summary |
| `list_assets`          | type?                                                    | ScriptableObjects and assets grouped by type  |

#### Drill-down

| Tool                | Parameters                         | Returns                                         |
| ------------------- | ---------------------------------- | ----------------------------------------------- |
| `get_game_object`   | scene, name_or_id                  | Full component detail, non-default fields only  |
| `get_component`     | scene, game_object, component_type | Single component's serialized fields            |
| `get_script_detail` | class_name                         | Full member list with signatures and attributes |
| `get_script_member` | class_name, member_name            | Single member detail                            |

#### Cross-references

| Tool                | Parameters   | Returns                                     |
| ------------------- | ------------ | ------------------------------------------- |
| `find_references`   | guid_or_name | All incoming references with source context |
| `find_dependencies` | guid_or_name | All outgoing references                     |
| `resolve_guid`      | guid         | File path + type                            |

#### Search

| Tool              | Parameters                            | Returns                                    |
| ----------------- | ------------------------------------- | ------------------------------------------ |
| `search`          | query, scope? (scenes/scripts/assets) | Ranked results with summary lines          |
| `find_components` | type, scene?                          | All components of given type across scenes |

#### Change Tracking

| Tool             | Parameters     | Returns                                 |
| ---------------- | -------------- | --------------------------------------- |
| `recent_changes` | since?, limit? | Recently changed files with change type |

### Response Format

All tools return structured JSON with a `token_hint` field (estimated token cost). Example:

```json
{
  "scene": "Assets/Scenes/MainScene.unity",
  "token_hint": 450,
  "roots": [
    {
      "name": "Player",
      "components": "Transform, Rigidbody2D, PlayerController, CapsuleCollider2D",
      "children_summary": "Sprite, HitBox, WeaponMount (2 children), Shadow",
      "importance": 0.95
    }
  ]
}
```

## Error Handling & Edge Cases

### Unity-specific

- **Corrupted YAML** — skip unparseable blocks, index what's possible, mark file `partial`
- **Missing .meta files** — index file without GUID, update when .meta appears
- **Binary assets** — detect binary header, skip, surface "enable Force Text" recommendation in project summary
- **Massive scenes (50K+ lines)** — stream YAML documents, batch SQLite inserts (500 per batch)
- **Prefab variant chains** — resolve full chain, store effective values at each level
- **Generated code** — detect markers, flag `is_generated`, lower importance score
- **Packages/** — index with lower importance, configurable: skip or index for reference resolution only

### File Watcher

- **Reimport storms** — debounce + hash-check prevents unnecessary re-parsing
- **Git branch switches** — bulk change detection triggers full re-index
- **File deletions** — cascade delete through all dependent tables, update reference counts and summaries

### SQLite

- WAL mode for concurrent reads during writes
- Transactions per file batch
- Integrity check on startup, rebuild if corruption detected
