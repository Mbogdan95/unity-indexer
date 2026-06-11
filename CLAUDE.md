# unity-indexer MCP Tools

This project has the unity-indexer MCP server active. Use these tools instead of reading Unity asset files (`.unity`, `.prefab`, `.asset`, `.meta`) directly — they are YAML binary blobs that are expensive to parse manually.

## Starting the server

If tools are unavailable, start the server:

```bash
npx unity-indexer <path-to-unity-project>
```

For auto-discovery (watches for Unity projects):

```bash
npx unity-indexer
```

## Available Tools (22)

### Scene & Prefab

| Tool                   | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | GameObject tree for a scene or prefab. Use before drilling into specific objects. |
| `get_prefab_structure` | GameObject structure for a prefab file.                                           |
| `get_game_object`      | Full details (components, children) for a specific GameObject.                    |
| `get_component`        | A specific component on a named GameObject.                                       |

### Scripts (C#)

| Tool                      | Purpose                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_scripts`            | List C# classes, filterable by namespace, base class, assembly, or MonoBehaviour. Start here when exploring an unfamiliar system.                                        |
| `get_script_detail`       | Members (fields, methods, properties) with signatures and line numbers, plus callers/callees/implementors. Returns `file_path` — use with `Read` to fetch method bodies. |
| `batch_get_script_detail` | Same as `get_script_detail` but for multiple classes in one call.                                                                                                        |
| `get_script_member`       | Details for a single member of a class.                                                                                                                                  |

### References & Dependencies

| Tool                | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `find_references`   | Everything that references a GUID or class name — scene/prefab usage and code callers. |
| `find_dependencies` | Outgoing references from a file, class, or GUID.                                       |
| `resolve_guid`      | Resolve a Unity GUID to a file path and asset type.                                    |

### Graph (code structure)

| Tool                 | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `trace_dependencies` | Transitive dependency chain from a class.              |
| `trace_dependents`   | Everything that depends on a class (impact analysis).  |
| `find_path`          | Shortest relationship path between two nodes.          |
| `get_subgraph`       | Local neighborhood of a node.                          |
| `detect_cycles`      | Find circular dependencies in a namespace or assembly. |
| `get_graph_stats`    | Graph metrics (node counts, edge counts, density).     |
| `find_implementors`  | All classes implementing a given interface.            |

### Search & Assets

| Tool              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                |
| `find_components` | All GameObjects that have a specific component type attached. |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.       |
| `recent_changes`  | Files changed recently (pass ISO timestamp to filter).        |

## Multiple projects

If multiple Unity projects are indexed, pass `project: "<name>"` to scope any tool call. Omit when only one project is indexed.
