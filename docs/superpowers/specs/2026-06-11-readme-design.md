# README Design Spec

**Date:** 2026-06-11

## Goal

Write a comprehensive `README.md` for the unity-indexer GitHub repo targeting both Claude Code plugin users and npm/manual MCP users equally.

## Constraints

- No unsubstantiated performance claims (no "10-50x token reduction" — benchmarks don't exist yet)
- All 22 MCP tools documented inline (not deferred to other files)
- Both installation paths presented with equal weight

## Structure

### 1. Header

- H1 title: `unity-indexer`
- One-line tagline: "Token-efficient Unity project explorer for Claude Code"
- Badges: npm version, license (MIT)

### 2. What it does

2-3 sentences covering:

- Indexes a Unity project (scenes, prefabs, C# scripts, assets) into SQLite
- Exposes 22 MCP tools so Claude can explore the project via structured queries instead of reading raw `.unity`/`.prefab`/`.asset` files
- Works as a Claude Code plugin (auto-registered) or a standalone MCP server

### 3. Installation

Two equal subsections:

**Claude Code Plugin (recommended)**

```
/plugins install github:Mbogdan95/unity-indexer
```

Note: MCP server auto-registers — no manual configuration needed.

**npm / Manual**

```bash
# Option A: run without installing
npx unity-indexer install          # registers in ~/.claude/settings.json
npx unity-indexer <project-path>   # start server

# Option B: global install
npm install -g unity-indexer
unity-indexer install
unity-indexer <project-path>
```

Note: `install` command writes to Claude Code settings. `--scope` flag controls which settings file (global, local, project, project-local).

### 4. Starting the server

Two modes:

- **Direct path:** `npx unity-indexer <path-to-unity-project>` — indexes one project
- **Auto-discovery:** `npx unity-indexer` (no args) — scans cwd up to 3 levels deep for Unity projects (directories containing both `Assets/` and `ProjectSettings/`), indexes all found

Note: database stored in `.unity-indexer/` at project root (auto-added to `.gitignore`).

### 5. How it works

Four-layer architecture diagram (ASCII):

```
┌─────────────────────────────────┐
│  MCP Server (tools/resources)   │  ← Claude Code interface
├─────────────────────────────────┤
│  Query Engine                   │  ← MCP calls → SQL
├─────────────────────────────────┤
│  Index Store (SQLite)           │  ← persistent structured index
├─────────────────────────────────┤
│  Parser Pipeline                │
│  ├─ Scene / Prefab (.unity/.prefab) │
│  ├─ Script (.cs via tree-sitter) │
│  ├─ Asset (.asset)              │
│  └─ Meta (.meta) + AsmDef      │
└─────────────────────────────────┘
```

Data flow paragraph: file watcher (chokidar) detects changes → parser extracts structured data → upserts into SQLite → MCP tools query on demand.

Key design choice: C# parsing uses tree-sitter (signatures + relationships, not method bodies). Method bodies fetched on demand via `file_path` + line numbers returned by tools.

### 6. Available Tools (22)

Five-group table layout matching CLAUDE.md exactly:

**Scene & Prefab** (4 tools): get_scene_hierarchy, get_prefab_structure, get_game_object, get_component

**Scripts (C#)** (4 tools): list_scripts, get_script_detail, batch_get_script_detail, get_script_member

**References & Dependencies** (3 tools): find_references, find_dependencies, resolve_guid

**Graph** (7 tools): trace_dependencies, trace_dependents, find_path, get_subgraph, detect_cycles, get_graph_stats, find_implementors

**Search & Assets** (4 tools): search, find_components, list_assets, recent_changes

Each tool gets: tool name (code), one-line description. Same descriptions as CLAUDE.md.

### 7. Multi-project setup

- Auto-discovery finds multiple projects automatically
- Pass `project: "<name>"` param to scope any tool call when multiple projects are indexed
- Project name = directory name of the Unity project root

### 8. Development

Commands from package.json:

```bash
npm run build       # tsc
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run ci          # typecheck + lint + format-check + test + build
```

Node.js >= 18 required.

### 9. License

MIT — link to LICENSE file.

## Out of scope

- Performance benchmarks (no data yet)
- Screenshots or GIFs
- Changelog
- Contributing guidelines (can be added later)
