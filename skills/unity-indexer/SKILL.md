# unity-indexer: Unity Project Exploration Workflows

Use this skill when exploring, debugging, or modifying a Unity project. It describes which MCP tools to call in which order for common tasks.

## Prerequisites

unity-indexer MCP server must be running and the project indexed. If tools return "no store", run:

```bash
npx unity-indexer <path-to-unity-project>
```

---

## Workflow 1: Understand a scene's structure

Goal: Orient yourself in an unfamiliar scene before editing.

1. `get_scene_hierarchy(scene: "Assets/Scenes/Main.unity")` — get full GameObject tree
2. For any interesting GameObject: `get_game_object(scene, name_or_id)` — see its components
3. For any unknown component: `get_script_detail(class_name)` — see its members and callers

---

## Workflow 2: Find where a component is used

Goal: Know all GameObjects that have a given component before changing it.

1. `find_components(type: "PlayerController")` — all GameObjects with this component
2. `find_references(guid_or_name: "PlayerController")` — code callers + scene/prefab usage
3. `get_script_detail(class_name: "PlayerController")` — members, callers, file_path + lines

---

## Workflow 3: Trace an event or subscription chain

Goal: Understand what fires an event and what handles it.

1. `get_script_detail(class_name: "EventBus")` — find the event field or method
2. `find_references(guid_or_name: "EventBus")` — everything that references it
3. For each subscriber class: `get_script_detail` — confirm subscribe/unsubscribe pattern
4. `get_subgraph(node: "EventBus", depth: 2)` — visual neighborhood if chain is complex

---

## Workflow 4: Understand dependencies before editing a class

Goal: Avoid breaking callers when changing a class.

1. `get_script_detail(class_name: "HealthSystem")` — current members and relationships
2. `trace_dependents(class_name: "HealthSystem")` — everything that depends on it
3. `detect_cycles(class_name: "HealthSystem")` — check for circular deps that could tangle a refactor
4. `batch_get_script_detail(class_names: ["HealthSystem", "PlayerController", "GameManager"])` — review related classes in one call

---

## Workflow 5: Find a prefab and its script bindings

Goal: Understand a prefab's component setup and which scripts drive it.

1. `get_prefab_structure(prefab: "Assets/Prefabs/Enemy.prefab")` — full hierarchy
2. For each component found: `get_script_detail(class_name)` — members and file location
3. `find_references(guid_or_name: "Enemy")` — scenes and scripts that reference this prefab

---

## Workflow 6: Check what changed recently before debugging

Goal: Narrow down which files are likely responsible for a regression.

1. `recent_changes(since: "2026-06-01T00:00:00Z")` — files changed since a known-good date
2. For changed script files: `get_script_detail` — check members and callers
3. `find_references` on changed classes — see what might be broken downstream

---

## Tips

- Pass `project: "<name>"` if multiple Unity projects are indexed.
- `get_script_detail` returns `file_path`, `start_line`, `end_line` for each member — use these with the `Read` tool to fetch actual method bodies without reading the whole file.
- `batch_get_script_detail` saves round-trips when you already know the class names you need.
- `search(query: "Player", scope: "scripts")` is the fastest way to find a class when you only know part of the name.
