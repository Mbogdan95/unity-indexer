# Auto-Discovery & DB Relocation

## Problem

The indexer and MCP server currently require the exact Unity project folder path. Users opening a parent workspace folder (or a monorepo containing multiple Unity projects) must manually specify each project path. The database file (`.unity-indexer.db`) sits at the project root with no `.gitignore`, risking accidental commits.

## Goals

1. Accept any folder and automatically discover Unity projects within it (up to 3 levels deep).
2. Support multiple Unity projects under one root.
3. Move the database into a `.unity-indexer/` directory with a `.gitignore` so it's never tracked by git.
4. MCP server no longer requires an explicit project path argument.

## Unity Project Detection

A directory is a Unity project if it contains **both** `Assets/` and `ProjectSettings/` as direct children.

## Discovery Module

New file: `src/discovery.ts`

### `discoverUnityProjects(rootDir: string, maxDepth?: number): string[]`

- Walks `rootDir` breadth-first up to `maxDepth` (default 3).
- Returns absolute paths of directories matching the detection criteria.
- The root directory itself is checked at depth 0.
- Skips directories named: `node_modules`, `.git`, `Library`, `Temp`, `obj`, `Logs`, `Build`, `Builds`.
- Once a directory is identified as a Unity project, its children are not searched (a Unity project inside another would be pathological).
- Returns results sorted alphabetically by path.
- If no projects found, returns an empty array (caller decides how to handle).

## Database Relocation

### New layout

```
{unity-project}/
  .unity-indexer/
    index.db
    index.db-wal
    index.db-shm
    .gitignore      # contains: *
```

### Startup behavior

1. Create `.unity-indexer/` directory if it doesn't exist.
2. Write `.unity-indexer/.gitignore` containing `*` (idempotent — overwrite each time is fine).
3. Stale journal cleanup (`removeStaleJournals`) targets `{project}/.unity-indexer/index.db`.

### No migration

The old `.unity-indexer.db` file at the project root is not migrated. The index rebuilds from scratch on first run with the new path. This is acceptable because indexing is fast and the DB is a cache.

## Multi-Project Server Architecture

### Orchestration in `startServer`

`startServer` changes signature:

```typescript
export async function startServer(rootDir: string): Promise<void>;
```

Steps:

1. Call `discoverUnityProjects(rootDir)`.
2. If no projects found, log an error and exit with code 1.
3. Log all discovered projects.
4. For each project:
   - Compute `dbPath = join(projectPath, ".unity-indexer", "index.db")`.
   - Ensure `.unity-indexer/` dir and `.gitignore` exist.
   - Remove stale journals.
   - Create `Store`, `Indexer`, `FileWatcher`.
   - Run `indexer.indexAll()`.
   - Start watcher.
5. Register MCP resources and tools for all projects.
6. Connect transport.

### Project naming

Project name = directory basename of the Unity project path. Used in MCP URIs and as identifier in tool parameters.

If two projects share the same directory name (unlikely but possible in deeply nested structures), append a numeric suffix to the second one: `MyGame`, `MyGame-2`.

### Internal data structure

```typescript
interface ProjectInstance {
  name: string;
  projectRoot: string;
  store: Store;
  indexer: Indexer;
  watcher: FileWatcher;
}
```

A `Map<string, ProjectInstance>` keyed by project name holds all active projects.

## MCP Resources

Resources are namespaced by project name:

| Resource        | URI                      |
| --------------- | ------------------------ |
| Project summary | `unity://{name}/summary` |
| Project files   | `unity://{name}/files`   |

Each project registers its own pair of resources.

Additionally, a top-level discovery resource:

| Resource     | URI                |
| ------------ | ------------------ |
| All projects | `unity://projects` |

Returns a JSON array of `{ name, path, summary }` for each discovered project. Useful for MCP clients to know what's available.

## MCP Tools

All existing tools gain an optional `project` parameter (string).

- If provided, routes to the named project's store.
- If omitted and only one project exists, uses that project.
- If omitted and multiple projects exist, returns an error listing available project names.

Tool implementations (`src/mcp/tools.ts`) receive a resolver function instead of a direct `Store`:

```typescript
type StoreResolver = (projectName?: string) => Store;
```

`registerTools(server, resolver)` replaces `registerTools(server, store)`.

## CLI Changes

`src/index.ts`:

```typescript
const rootDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
startServer(rootDir).catch((err: unknown) => {
  console.error("Failed to start unity-indexer:", err);
  process.exit(1);
});
```

No longer computes `dbPath` — that's handled per-project inside `startServer`.

## File Watcher

No changes to `FileWatcher` internals. One watcher per discovered project, each watching its own `Assets/` directory.

## Cleanup

Shutdown handler iterates all `ProjectInstance` entries, stops watchers, closes stores.

## Error Handling

- No Unity projects found → log error with searched path and exit 1.
- Discovery dir doesn't exist → log error and exit 1.
- Individual project fails to index → log warning, skip that project, continue with others.
- All projects fail → exit 1.

## Out of Scope

- Hot-reloading when new Unity projects appear in the root dir after startup.
- Migration of old `.unity-indexer.db` files.
- Configuration file for custom search depth or skip patterns.
