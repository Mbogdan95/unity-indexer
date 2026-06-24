# unity-indexer MCP Tools

Use these MCP tools when working with Unity projects. They are faster and more token-efficient than reading `.unity`, `.prefab`, `.asset`, or `.meta` files directly — those are YAML blobs with GUIDs that require extensive parsing.

## Server startup

If tools return "no store" or are unavailable, start the server:

```bash
npx unity-indexer <path-to-unity-project>
```

For auto-discovery (scans 3 levels deep for Unity projects):

```bash
npx unity-indexer
```

## Tools (23)

### Scene & Prefab

| Tool                   | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | Full GameObject tree for a scene or prefab. Start here when orienting in an unfamiliar scene. |
| `get_prefab_structure` | GameObject hierarchy for a prefab file.                                                       |
| `get_game_object`      | Full details (components, children) for a specific GameObject.                                |
| `get_component`        | A specific component on a named GameObject.                                                   |

### Scripts (C#)

| Tool                      | Purpose                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_scripts`            | List C# classes, filterable by namespace, base class, assembly, or MonoBehaviour. Start here when exploring an unfamiliar system.                                        |
| `get_script_detail`       | Members (fields, methods, properties) with signatures and line numbers, plus callers/callees/implementors. Returns `file_path` — use with `Read` to fetch method bodies. |
| `batch_get_script_detail` | Same as `get_script_detail` for multiple classes in one call.                                                                                                            |
| `get_script_member`       | Details for a single member of a class.                                                                                                                                  |

### References & Dependencies

| Tool                | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `find_references`   | Everything that references a GUID or class name — scene/prefab usage and code callers. |
| `find_dependencies` | Outgoing references from a file, class, or GUID.                                       |
| `resolve_guid`      | Resolve a Unity GUID to a file path and asset type.                                    |

### Graph

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

| Tool              | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `search`          | Search files, GameObjects, or scripts by name.                          |
| `find_components` | All GameObjects that have a specific component type attached.           |
| `list_assets`     | Unity `.asset` files, optionally filtered by type name.                 |
| `recent_changes`  | Files changed recently (pass ISO 8601 timestamp to filter).             |
| `find_unused`     | Find scripts, assets, or scenes not referenced anywhere in the project. |

## Workflows

### Orient in a scene

1. `get_scene_hierarchy(scene: "Assets/Scenes/Main.unity")` — full GameObject tree
2. `get_game_object(scene, name_or_id)` — components on any interesting object
3. `get_script_detail(class_name)` — members and callers for unknown components

### Find all uses of a component

1. `find_components(type: "PlayerController")` — all GameObjects with this component
2. `find_references(guid_or_name: "PlayerController")` — code callers + scene/prefab usage
3. `get_script_detail(class_name: "PlayerController")` — members, file_path + lines

### Trace an event chain

1. `get_script_detail(class_name: "EventBus")` — find the event field
2. `find_references(guid_or_name: "EventBus")` — everything referencing it
3. `get_subgraph(node: "EventBus", depth: 2)` — visual neighborhood for complex chains

### Understand dependencies before editing

1. `get_script_detail(class_name: "HealthSystem")` — current members and relationships
2. `trace_dependents(class_name: "HealthSystem")` — everything depending on it
3. `detect_cycles(class_name: "HealthSystem")` — circular deps that could tangle a refactor
4. `batch_get_script_detail(class_names: ["HealthSystem", "PlayerController", "GameManager"])` — review related classes in one call

### Explore a prefab

1. `get_prefab_structure(prefab: "Assets/Prefabs/Enemy.prefab")` — full hierarchy
2. `get_script_detail(class_name)` — for each component found
3. `find_references(guid_or_name: "Enemy")` — scenes and scripts using this prefab

### Narrow down a regression

1. `recent_changes(since: "2026-06-01T00:00:00Z")` — files changed since known-good date
2. `get_script_detail` on changed scripts — members and callers
3. `find_references` on changed classes — downstream breakage

## Tips

- Multiple Unity projects indexed? Pass `project: "<name>"` to scope any tool call.
- `get_script_detail` returns `file_path`, `start_line`, `end_line` per member — use `Read` with offset/limit to fetch method bodies without reading the whole file.
- `batch_get_script_detail` saves round-trips when you already know the class names.
- `search(query: "Player", scope: "scripts")` finds a class by partial name fastest.
