# unity-indexer

[![npm version](https://img.shields.io/npm/v/unity-indexer)](https://www.npmjs.com/package/unity-indexer)
[![license](https://img.shields.io/npm/l/unity-indexer)](LICENSE)

Token-efficient Unity project explorer for Claude Code.

## What it does

unity-indexer indexes a Unity project — scenes, prefabs, C# scripts, and assets — into a SQLite database and exposes 22 MCP tools so Claude can explore the project via structured queries. Instead of reading raw `.unity`, `.prefab`, and `.asset` files (Unity's non-standard YAML with GUIDs), Claude calls purpose-built tools that return exactly the data needed.

Works as a Claude Code plugin (MCP server auto-registered on install) or as a standalone npm package.

## Installation

### Claude Code Plugin

```text
/plugins install github:Mbogdan95/unity-indexer
```

The MCP server is auto-registered — no manual configuration needed.

### npm / Manual

```bash
# Option A: without global install
npx unity-indexer install          # registers in ~/.claude/settings.json
npx unity-indexer <project-path>   # start the server

# Option B: global install
npm install -g unity-indexer
unity-indexer install
unity-indexer <project-path>
```

The `install` command writes to Claude Code settings. Use `--scope` to control which settings file:

| Scope              | File                            |
| ------------------ | ------------------------------- |
| `global` (default) | `~/.claude/settings.json`       |
| `local`            | `~/.claude/settings.local.json` |
| `project`          | `.claude/settings.json`         |
| `project-local`    | `.claude/settings.local.json`   |

```bash
unity-indexer install --scope project
```

## Starting the server

**Direct path** — index a specific project:

```bash
npx unity-indexer <path-to-unity-project>
```

**Auto-discovery** — scan for Unity projects automatically:

```bash
npx unity-indexer
```

With no arguments, unity-indexer scans the current directory up to 3 levels deep for Unity projects (directories containing both `Assets/` and `ProjectSettings/`). All discovered projects are indexed.

The database is stored in `.unity-indexer/` at each project root and is automatically added to `.gitignore`.

## How it works

```
┌─────────────────────────────────────┐
│  MCP Server (tools/resources)       │  ← Claude Code interface
├─────────────────────────────────────┤
│  Query Engine                       │  ← MCP calls → SQL
├─────────────────────────────────────┤
│  Index Store (SQLite)               │  ← persistent structured index
├─────────────────────────────────────┤
│  Parser Pipeline                    │
│  ├─ Scene / Prefab (.unity/.prefab) │
│  ├─ Script (.cs via tree-sitter)    │
│  ├─ Asset (.asset)                  │
│  └─ Meta (.meta) + AsmDef (.asmdef) │
└─────────────────────────────────────┘
```

A file watcher (chokidar) detects changes, parsers extract structured data, and the index is updated incrementally. MCP tools query SQLite on demand — no file reads at query time.

C# parsing uses tree-sitter to extract signatures, members, and relationships. Method bodies are not stored; tools return `file_path` and line numbers so Claude can fetch only what it needs with the `Read` tool.

## Available Tools

### Scene & Prefab

| Tool                   | Description                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | GameObject tree for a scene or prefab. Start here when orienting in an unfamiliar scene. |
| `get_prefab_structure` | GameObject hierarchy for a prefab file.                                                  |
| `get_game_object`      | Full details (components, children) for a specific GameObject.                           |
| `get_component`        | A specific component on a named GameObject.                                              |

### Scripts (C#)

| Tool                      | Description                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `list_scripts`            | List C# classes, filterable by namespace, base class, assembly, or MonoBehaviour.                                     |
| `get_script_detail`       | Members with signatures and line numbers, plus callers/callees/implementors. Returns `file_path` for use with `Read`. |
| `batch_get_script_detail` | Same as `get_script_detail` for multiple classes in one call.                                                         |
| `get_script_member`       | Details for a single member of a C# class.                                                                            |

### References & Dependencies

| Tool                | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `find_references`   | All files and code that reference a GUID or class name — scene/prefab usage and code callers. |
| `find_dependencies` | Outgoing references from a file, class, or GUID.                                              |
| `resolve_guid`      | Resolve a Unity GUID to a file path and asset type.                                           |

### Graph

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `trace_dependencies` | Transitive dependency chain from a class.              |
| `trace_dependents`   | Everything that depends on a class (impact analysis).  |
| `find_path`          | Shortest relationship path between two nodes.          |
| `get_subgraph`       | Local neighborhood of a node.                          |
| `detect_cycles`      | Find circular dependencies in a namespace or assembly. |
| `get_graph_stats`    | Graph metrics: node counts, edge counts, density.      |
| `find_implementors`  | All classes implementing a given interface.            |

### Search & Assets

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                |
| `find_components` | All GameObjects that have a specific component type attached. |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.       |
| `recent_changes`  | Files changed recently. Pass an ISO 8601 timestamp to filter. |

## Multiple projects

When multiple Unity projects are indexed, pass `project: "<name>"` to scope any tool call. The project name is the directory name of the Unity project root.

Omit the parameter when only one project is indexed.

## Development

Node.js >= 18 required.

```bash
npm run build      # compile TypeScript
npm run test       # run tests (vitest)
npm run typecheck  # type-check without emitting
npm run lint       # eslint
npm run ci         # typecheck + lint + format-check + test + build
```

## License

[MIT](LICENSE)
