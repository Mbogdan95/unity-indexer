<div align="center">

# unity-indexer

**Token-efficient Unity project explorer for Claude Code**

[![npm version](https://img.shields.io/npm/v/unity-indexer)](https://www.npmjs.com/package/unity-indexer)
[![license](https://img.shields.io/npm/l/unity-indexer)](LICENSE)
[![node](https://img.shields.io/node/v/unity-indexer)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](tsconfig.json)

[Quick Start](#-quick-start) • [Installation](#-installation) • [How it works](#️-how-it-works) • [Tools](#-available-tools) • [Development](#️-development)

</div>

---

unity-indexer indexes a Unity project — scenes, prefabs, C# scripts, and assets — into a SQLite database and exposes 22 MCP tools so Claude can explore the project via structured queries. Instead of reading raw `.unity`, `.prefab`, and `.asset` files (Unity's non-standard YAML with GUIDs), Claude calls purpose-built tools that return exactly what's needed.

Works as a Claude Code plugin (MCP server auto-registered on install) or as a standalone npm package.

---

## ⚡ Quick Start

**Claude Code plugin — zero config:**

```text
/plugins install github:Mbogdan95/unity-indexer
```

> [!TIP]
> That's it. The MCP server auto-registers and tools are available immediately.

**npm — manual setup:**

```bash
npx unity-indexer install            # register in Claude Code settings
npx unity-indexer <path-to-project>  # start the server
```

---

## 📦 Installation

### Claude Code Plugin

```text
/plugins install github:Mbogdan95/unity-indexer
```

> [!NOTE]
> The MCP server is auto-registered when the plugin is installed — no manual configuration needed.

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

---

## 🚀 Starting the server

**Direct path** — index a specific Unity project:

```bash
npx unity-indexer <path-to-unity-project>
```

**Auto-discovery** — scan the current directory for Unity projects:

```bash
npx unity-indexer
```

> [!NOTE]
> With no arguments, unity-indexer scans up to 3 levels deep for directories containing both `Assets/` and `ProjectSettings/`. All discovered projects are indexed and available via the `project:` parameter.

The index database is stored in `.unity-indexer/` at each project root and is automatically added to `.gitignore`.

---

## 🏗️ How it works

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

A file watcher (chokidar) detects changes → parsers extract structured data → SQLite index updates incrementally → MCP tools query on demand.

C# parsing uses tree-sitter to extract class members, signatures, and relationships. Method bodies are not stored in the index — instead, tools return `file_path` and line numbers so Claude can fetch exactly what it needs with the `Read` tool.

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
<summary><strong>🔍 Search &amp; Assets</strong> — 4 tools</summary>

<br>

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                |
| `find_components` | All GameObjects that have a specific component type attached. |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.       |
| `recent_changes`  | Files changed recently. Pass an ISO 8601 timestamp to filter. |

</details>

---

## 📁 Multiple projects

When multiple Unity projects are indexed, pass `project: "<name>"` to scope any tool call to a specific project. The project name is the directory name of the Unity project root.

```
project: "MyGame"
```

Omit the parameter when only one project is indexed.

---

## 🛠️ Development

Node.js >= 18 required.

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
