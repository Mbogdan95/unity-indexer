<div align="center">

# unity-indexer

**Token-efficient Unity project explorer for Claude Code**

[![license](https://img.shields.io/github/license/Mbogdan95/unity-indexer)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.17.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6)](tsconfig.json)

[Quick Start](#-quick-start) • [How it works](#️-how-it-works) • [Tools](#-available-tools) • [Development](#️-development)

</div>

---

unity-indexer indexes a Unity project — scenes, prefabs, C# scripts, and assets — into a SQLite database and exposes 23 MCP tools so Claude can explore the project via structured queries. Instead of reading raw `.unity`, `.prefab`, and `.asset` files (Unity's non-standard YAML with GUIDs), Claude calls purpose-built tools that return exactly what's needed.

Distributed as a Claude Code plugin via GitHub with automatic MCP server registration on install.

---

## ⚡ Quick Start

**Claude Code:**

```text
/plugin marketplace add Mbogdan95/unity-indexer
/plugin install unity-indexer@unity-indexer
```

**Cursor:**

```text
/plugin marketplace add Mbogdan95/unity-indexer
/add-plugin unity-indexer
```

> [!TIP]
> MCP server auto-registers on install. Tools are available in the next session.

---

## 🏗️ How it works

### Architecture

<div align="center">

```
  ┌───────────────────────────────────────────┐
  │         Claude Code  (MCP client)         │
  └─────────────────────┬─────────────────────┘
                        │ 23 MCP tool calls
  ┌─────────────────────▼─────────────────────┐
  │               MCP Server                  │
  └─────────────────────┬─────────────────────┘
                        │ SQL + graph queries
  ┌─────────────────────▼─────────────────────┐
  │              Index Store                  │
  │                                           │
  │  SQLite                Graphology         │
  │  ├─ files              (in-memory)        │
  │  ├─ game_objects       ├─ INHERITS        │
  │  ├─ components         ├─ IMPLEMENTS      │
  │  ├─ scripts            ├─ CALLS           │
  │  ├─ script_members     ├─ SUBSCRIBES_TO   │
  │  ├─ guids              └─ USES            │
  │  ├─ references                            │
  │  └─ graph_edges ──────▶ loaded on start   │
  └─────────────────────┬─────────────────────┘
                        │ parse & upsert
  ┌─────────────────────▼─────────────────────┐
  │            Parser Pipeline                │
  │                                           │
  │  .meta    ──▶  GUID registry              │
  │  .cs      ──▶  tree-sitter AST            │
  │  .unity   ──▶  scene hierarchy            │
  │  .prefab  ──▶  prefab tree                │
  │  .asset   ──▶  ScriptableObject fields    │
  │  .asmdef  ──▶  assembly dependencies      │
  └─────────────────────┬─────────────────────┘
                        │ file events
  ┌─────────────────────▼─────────────────────┐
  │        File Watcher  (chokidar)           │
  │        Assets/  ·  500 ms debounce        │
  └───────────────────────────────────────────┘
```

</div>

---

### Indexing pipeline

On first run, unity-indexer walks `Assets/` and indexes files in four phases:

| Phase                | Files               | Why first                                                                                              |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| 1 — Meta             | `.meta`             | Builds the GUID → file path registry. Every subsequent parser needs this to resolve asset references.  |
| 2 — Scripts          | `.cs`               | Populates the class registry. Scene/prefab parsers need class names to resolve component script GUIDs. |
| 3 — Scenes & Prefabs | `.unity`, `.prefab` | Resolves GUIDs to class names using phases 1 & 2. Builds the full GameObject hierarchy.                |
| 4 — Assets & AsmDefs | `.asset`, `.asmdef` | ScriptableObject data and assembly dependency graph.                                                   |

Each file passes a two-stage guard before parsing: **mtime check** (fast — skips unchanged files) then **SHA-256 content hash** (catches content changes with no mtime update). Only changed files are re-parsed.

---

### C# parsing

Scripts are parsed with [tree-sitter](https://tree-sitter.github.io/) (C# WASM grammar — no external toolchain). The parser extracts:

- Class name, namespace, base class, interfaces
- Members: fields, methods, properties, events — with access modifiers, return types, parameters, attributes, and **exact line numbers**
- Unity-specific flags: `MonoBehaviour`, `ScriptableObject`, `Editor` subclass detection
- Relationships: what this class calls, inherits, implements, uses, or subscribes to

Method bodies are **not stored**. Tools return `file_path` + `start_line`/`end_line` per member — fetch bodies on demand with `Read`.

---

### Code graph

C# class relationships are stored as a directed graph ([graphology](https://graphology.github.io/)) with five edge types:

| Edge            | Meaning                                  |
| --------------- | ---------------------------------------- |
| `INHERITS`      | Class extends another class              |
| `IMPLEMENTS`    | Class implements an interface            |
| `CALLS`         | Method calls a method on another class   |
| `SUBSCRIBES_TO` | Event subscription (`+=`)                |
| `USES`          | Field/property reference to another type |

Graph tools (`trace_dependencies`, `find_path`, `detect_cycles`, etc.) load this graph in-memory from `graph_edges` in SQLite and run graphology algorithms over it.

---

### Incremental updates

The file watcher monitors `Assets/` (not `Packages/` — rarely changes). Changes batch with a **500 ms debounce** to avoid thrashing on large saves. When more than 50 files change within 2 seconds (e.g. a git checkout), the indexer switches to bulk mode and reindexes all affected files.

---

### Importance scoring & summaries

Every file and GameObject gets a float `importance_score [0, 1]` from:

- Incoming reference count (how many other files reference it)
- Presence of custom scripts
- Change frequency
- Hierarchy depth (for GameObjects)

Scores rank results — high-importance items surface first.

Pre-computed one-line summaries (`component_summary`, `api_summary`, `subtree_summary`) are stored alongside structured data. Most tools return summaries by default; drill-down calls fetch full detail on demand.

---

### SQLite schema (key tables)

| Table            | Contents                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `files`          | Every indexed file with type, hash, mtime, importance score              |
| `guids`          | GUID → file path mapping from `.meta` files                              |
| `game_objects`   | GameObject hierarchy with component summary + subtree summary            |
| `components`     | Component type, script GUID, serialized fields (default values stripped) |
| `scripts`        | C# class metadata: namespace, base class, interfaces, assembly           |
| `script_members` | Fields, methods, properties with signatures and line numbers             |
| `references`     | GUID-based cross-file references (scene/prefab → script/asset)           |
| `graph_edges`    | Code relationship graph (INHERITS, CALLS, USES, etc.)                    |
| `change_log`     | Timestamped file change history                                          |
| `assemblies`     | `.asmdef` data with dependency graph                                     |

---

## 🔧 Available Tools

<details>
<summary><strong>🎬 Scene &amp; Prefab</strong> — 4 tools</summary>

<br>

| Tool                   | Description                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | GameObject tree for a scene or prefab. Start here when orienting in an unfamiliar scene. |
| `get_prefab_structure` | GameObject hierarchy for a prefab file.                                                  |
| `get_game_object`      | Full details (components, children) for a specific GameObject.                           |
| `get_component`        | A specific component on a named GameObject.                                              |

</details>

<details>
<summary><strong>📜 Scripts (C#)</strong> — 4 tools</summary>

<br>

| Tool                      | Description                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `list_scripts`            | List C# classes, filterable by namespace, base class, assembly, or MonoBehaviour.                                     |
| `get_script_detail`       | Members with signatures and line numbers, plus callers/callees/implementors. Returns `file_path` for use with `Read`. |
| `batch_get_script_detail` | Same as `get_script_detail` for multiple classes in one call.                                                         |
| `get_script_member`       | Details for a single member of a C# class.                                                                            |

</details>

<details>
<summary><strong>🔗 References &amp; Dependencies</strong> — 3 tools</summary>

<br>

| Tool                | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `find_references`   | All files and code that reference a GUID or class name — scene/prefab usage and code callers. |
| `find_dependencies` | Outgoing references from a file, class, or GUID.                                              |
| `resolve_guid`      | Resolve a Unity GUID to a file path and asset type.                                           |

</details>

<details>
<summary><strong>🕸️ Graph</strong> — 7 tools</summary>

<br>

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `trace_dependencies` | Transitive dependency chain from a class.              |
| `trace_dependents`   | Everything that depends on a class (impact analysis).  |
| `find_path`          | Shortest relationship path between two nodes.          |
| `get_subgraph`       | Local neighborhood of a node.                          |
| `detect_cycles`      | Find circular dependencies in a namespace or assembly. |
| `get_graph_stats`    | Graph metrics: node counts, edge counts, density.      |
| `find_implementors`  | All classes implementing a given interface.            |

</details>

<details>
<summary><strong>🔍 Search &amp; Assets</strong> — 5 tools</summary>

<br>

| Tool              | Description                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                                                                                                                                      |
| `find_components` | All GameObjects that have a specific component type attached.                                                                                                                       |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.                                                                                                                             |
| `recent_changes`  | Files changed recently. Pass an ISO 8601 timestamp to filter.                                                                                                                       |
| `find_unused`     | Find scripts, assets, or scenes with no incoming references — a starting point for cleanup. Supports `asset_type` filter (`script`, `scene`, `prefab`, `asset`) and `min_days_old`. |

</details>

---

## 📁 Multiple projects

When multiple projects are indexed, pass `project: "<name>"` to scope any tool call. The name is the directory name of the Unity project root.

```
project: "MyGame"
```

Omit it when only one project is indexed.

---

## 🛠️ Development

Node.js >= 20.17.0 required.

```bash
npm run build      # compile TypeScript
npm run test       # run tests (vitest)
npm run typecheck  # type-check without emitting
npm run lint       # eslint
npm run ci         # typecheck + lint + format-check + test + build
```

---

## 📄 License

[MIT](LICENSE)
