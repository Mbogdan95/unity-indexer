import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../db/store.js";
import { encodeNodeId } from "../types.js";

export type StoreResolver = (projectName?: string) => Store;

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

function resolveToNodeId(store: Store, identifier: string): string | null {
  const script = store.getScriptByClassName(identifier);
  if (script) return encodeNodeId("script", script.id);
  const file = store.getFileByPath(identifier);
  if (file) return encodeNodeId("file", file.id);
  if (identifier.includes(":")) return identifier;
  return null;
}

// ---------------------------------------------------------------------------
// Handler functions (exported for testing)
// ---------------------------------------------------------------------------

export function handleGetSceneHierarchy(
  store: Store,
  params: { scene: string; depth?: number; filter?: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  let allGOs = store.getGameObjectsByFile(file.id);
  let resolvedFrom: string | undefined;

  if (allGOs.length === 0 && file.type === "prefab") {
    const baseFileId = store.resolveVariantBase(file.id);
    if (baseFileId !== null) {
      allGOs = store.getGameObjectsByFile(baseFileId);
      const baseFile = store.getFileById(baseFileId);
      resolvedFrom = baseFile?.path;
    }
  }

  const maxDepth = params.depth ?? Infinity;
  const filterLower = params.filter?.toLowerCase();

  const filtered = allGOs.filter((go) => {
    if (go.depth > maxDepth) return false;
    if (filterLower !== undefined) {
      const nameMatch = go.name.toLowerCase().includes(filterLower);
      const tagMatch = go.tag.toLowerCase().includes(filterLower);
      if (!nameMatch && !tagMatch) return false;
    }
    return true;
  });

  const roots = filtered
    .filter((go) => go.parent_file_id_local === null)
    .sort((a, b) => b.importance_score - a.importance_score);

  const response = {
    scene: params.scene,
    ...(resolvedFrom !== undefined ? { resolved_from: resolvedFrom, is_variant: true } : {}),
    roots: roots.map((go) => ({
      name: go.name,
      components: go.component_summary,
      children_summary: go.subtree_summary,
      importance: go.importance_score,
      ...(go.tag !== "Untagged" ? { tag: go.tag } : {}),
      ...(!go.active ? { active: false } : {}),
    })),
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetPrefabStructure(
  store: Store,
  params: { prefab: string; depth?: number; filter?: string },
): object {
  return handleGetSceneHierarchy(store, {
    scene: params.prefab,
    depth: params.depth,
    filter: params.filter,
  });
}

export function handleListScripts(
  store: Store,
  params: {
    namespace?: string;
    base_class?: string;
    assembly?: string;
    is_monobehaviour?: boolean;
  },
): object {
  const scripts = store.listScripts({
    namespace: params.namespace,
    baseClass: params.base_class,
    assembly: params.assembly,
    isMonoBehaviour: params.is_monobehaviour,
  });

  const response = {
    scripts: scripts.map((s) => ({
      class_name: s.class_name,
      ...(s.namespace ? { namespace: s.namespace } : {}),
      ...(s.base_class ? { base_class: s.base_class } : {}),
      api_summary: s.api_summary,
      ...(s.is_monobehaviour ? { is_monobehaviour: true } : {}),
      ...(s.is_generated ? { is_generated: true } : {}),
      complexity: s.complexity_score,
    })),
    total: scripts.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleListAssets(store: Store, params: { type?: string }): object {
  const files = store.listFiles("asset");
  const typeFilter = params.type;
  const filtered =
    typeFilter !== undefined
      ? files.filter((f) => f.summary_line.toLowerCase().includes(typeFilter.toLowerCase()))
      : files;

  const response = {
    assets: filtered.map((f) => ({
      path: f.path,
      summary: f.summary_line,
    })),
    total: filtered.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetGameObject(
  store: Store,
  params: { scene: string; name_or_id: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  let go = store.getGameObjectByName(file.id, params.name_or_id);
  let resolvedFrom: string | undefined;

  if (!go && file.type === "prefab") {
    const baseFileId = store.resolveVariantBase(file.id);
    if (baseFileId !== null) {
      go = store.getGameObjectByName(baseFileId, params.name_or_id);
      const baseFile = store.getFileById(baseFileId);
      resolvedFrom = baseFile?.path;
    }
  }

  if (!go) return { token_hint: 10, error: `GameObject not found: ${params.name_or_id}` };

  const components = store.getComponentsByGameObject(go.id);

  const response = {
    name: go.name,
    ...(resolvedFrom !== undefined ? { resolved_from: resolvedFrom, is_variant: true } : {}),
    ...(go.tag !== "Untagged" ? { tag: go.tag } : {}),
    ...(go.layer !== 0 ? { layer: go.layer } : {}),
    ...(!go.active ? { active: false } : {}),
    depth: go.depth,
    ...(go.child_count > 0 ? { child_count: go.child_count } : {}),
    importance: go.importance_score,
    components: components.map((c) => ({
      type_name: c.type_name,
      ...(c.script_guid !== null && c.script_guid !== "" ? { script_guid: c.script_guid } : {}),
      field_summary: c.field_summary,
      serialized_fields: JSON.parse(c.serialized_fields) as unknown,
    })),
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetComponent(
  store: Store,
  params: { scene: string; game_object: string; component_type: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  let go = store.getGameObjectByName(file.id, params.game_object);
  let resolvedFrom: string | undefined;

  if (!go && file.type === "prefab") {
    const baseFileId = store.resolveVariantBase(file.id);
    if (baseFileId !== null) {
      go = store.getGameObjectByName(baseFileId, params.game_object);
      const baseFile = store.getFileById(baseFileId);
      resolvedFrom = baseFile?.path;
    }
  }

  if (!go) return { token_hint: 10, error: `GameObject not found: ${params.game_object}` };

  const components = store.getComponentsByGameObject(go.id);
  const comp = components.find(
    (c) => c.type_name.toLowerCase() === params.component_type.toLowerCase(),
  );

  if (!comp) {
    return {
      token_hint: 10,
      error: `Component '${params.component_type}' not found on '${params.game_object}'`,
    };
  }

  const response = {
    game_object: go.name,
    ...(resolvedFrom !== undefined ? { resolved_from: resolvedFrom, is_variant: true } : {}),
    type_name: comp.type_name,
    script_guid: comp.script_guid,
    field_summary: comp.field_summary,
    serialized_fields: JSON.parse(comp.serialized_fields) as unknown,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetScriptDetail(store: Store, params: { class_name: string }): object {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) {
    return { token_hint: 10, error: `Script not found: ${params.class_name}` };
  }

  const members = store.getScriptMembers(script.id);

  const response = {
    class_name: script.class_name,
    ...(script.namespace ? { namespace: script.namespace } : {}),
    ...(script.base_class ? { base_class: script.base_class } : {}),
    interfaces: JSON.parse(script.interfaces) as string[],
    ...(script.assembly_name ? { assembly_name: script.assembly_name } : {}),
    api_summary: script.api_summary,
    ...(script.is_monobehaviour ? { is_monobehaviour: true } : {}),
    ...(script.is_editor_script ? { is_editor_script: true } : {}),
    ...(script.is_scriptable_object ? { is_scriptable_object: true } : {}),
    ...(script.is_generated ? { is_generated: true } : {}),
    complexity: script.complexity_score,
    members: members.map((m) => {
      const attrs = JSON.parse(m.attributes) as string[];
      return {
        name: m.name,
        kind: m.kind,
        ...(m.access !== "public" ? { access: m.access } : {}),
        signature: m.signature,
        ...(attrs.length > 0 ? { attributes: attrs } : {}),
        ...(m.has_serialize_field ? { has_serialize_field: true } : {}),
      };
    }),
  };

  const scriptNodeId = encodeNodeId("script", script.id);
  const outgoing = store.graph.getOutgoing(scriptNodeId);
  const incoming = store.graph.getIncoming(scriptNodeId);

  const relationships = {
    inherits: outgoing.filter((n) => n.edgeType === "INHERITS").map((n) => n.nodeId),
    implements: outgoing.filter((n) => n.edgeType === "IMPLEMENTS").map((n) => n.nodeId),
    callees: outgoing.filter((n) => n.edgeType === "CALLS").map((n) => n.nodeId),
    callers: incoming.filter((n) => n.edgeType === "CALLS").map((n) => n.nodeId),
  };

  return { token_hint: estimateTokens({ ...response, relationships }), ...response, relationships };
}

export function handleGetScriptMember(
  store: Store,
  params: { class_name: string; member_name: string },
): object {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) {
    return { token_hint: 10, error: `Script not found: ${params.class_name}` };
  }

  const members = store.getScriptMembers(script.id);
  const member = members.find((m) => m.name.toLowerCase() === params.member_name.toLowerCase());

  if (!member) {
    return {
      token_hint: 10,
      error: `Member '${params.member_name}' not found in '${params.class_name}'`,
    };
  }

  const params_parsed = JSON.parse(member.parameters) as unknown;
  const attrs = JSON.parse(member.attributes) as string[];
  const response = {
    class_name: script.class_name,
    name: member.name,
    kind: member.kind,
    access: member.access,
    return_type: member.return_type,
    parameters: params_parsed,
    ...(attrs.length > 0 ? { attributes: attrs } : {}),
    signature: member.signature,
    has_serialize_field: member.has_serialize_field,
    has_header_attr: member.has_header_attr,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleFindReferences(
  store: Store,
  params: { guid_or_name: string; depth?: number },
): object {
  if (params.depth !== undefined && params.depth > 1) {
    const nodeId = resolveToNodeId(store, params.guid_or_name);
    if (nodeId === null) return { token_hint: 10, error: `Cannot resolve: ${params.guid_or_name}` };
    const result = store.graph.traceDependents(nodeId, params.depth);
    const response = {
      guid_or_name: params.guid_or_name,
      nodes: result.nodes.map((n) => ({ id: n.id, depth: n.depth })),
      edges: result.edges,
      total: result.nodes.length - 1,
    };
    return { token_hint: estimateTokens(response), ...response };
  }

  let guid = params.guid_or_name;

  // Heuristic: if it looks like a name (short, has dots/uppercase), resolve to GUID first
  const looksLikeName = guid.length < 32 || guid.includes(".") || /[A-Z]/.test(guid);

  if (looksLikeName) {
    // Try to find a script with this class name and resolve its GUID
    const script = store.getScriptByClassName(guid);
    if (script) {
      const fileRow = store.getFileById(script.file_id);
      if (fileRow) {
        const metaPath = fileRow.path + ".meta";
        const metaFile = store.getFileByPath(metaPath);
        if (metaFile) {
          const guidRow = store.getGuidByFileId(metaFile.id);
          if (guidRow) {
            guid = guidRow.guid;
          }
        }
      }
    }
  }

  const refs = store.getReferencesToGuid(guid);

  const response = {
    guid,
    references: refs.map((r) => {
      const sourceFile = store.getFileById(r.source_file_id);
      return {
        source_file: sourceFile?.path ?? `file_id:${String(r.source_file_id)}`,
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
    total: refs.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleFindDependencies(
  store: Store,
  params: { guid_or_name: string; depth?: number },
): object {
  if (params.depth !== undefined && params.depth > 1) {
    const nodeId = resolveToNodeId(store, params.guid_or_name);
    if (nodeId === null) return { token_hint: 10, error: `Cannot resolve: ${params.guid_or_name}` };
    const result = store.graph.traceDependencies(nodeId, params.depth);
    const response = {
      source: params.guid_or_name,
      nodes: result.nodes.map((n) => ({ id: n.id, depth: n.depth })),
      edges: result.edges,
      total: result.nodes.length - 1,
    };
    return { token_hint: estimateTokens(response), ...response };
  }

  let fileId: number | null = null;

  // Try to find by path first
  const fileByPath = store.getFileByPath(params.guid_or_name);
  if (fileByPath) {
    fileId = fileByPath.id;
  } else {
    // Try to resolve as a script class name
    const script = store.getScriptByClassName(params.guid_or_name);
    if (script) {
      fileId = script.file_id;
    } else {
      // Try to resolve GUID
      const guidRow = store.resolveGuid(params.guid_or_name);
      if (guidRow) {
        fileId = guidRow.file_id;
      }
    }
  }

  if (fileId === null) {
    return { token_hint: 10, error: `Cannot resolve: ${params.guid_or_name}` };
  }

  const refs = store.getReferencesFromFile(fileId);

  const response = {
    source: params.guid_or_name,
    dependencies: refs.map((r) => {
      const targetFile = r.target_file_id !== null ? store.getFileById(r.target_file_id) : null;
      return {
        target_guid: r.target_guid,
        target_file: targetFile?.path ?? null,
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
    total: refs.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleResolveGuid(store: Store, params: { guid: string }): object {
  const guidRow = store.resolveGuid(params.guid);
  if (!guidRow) {
    return { token_hint: 10, error: `GUID not found: ${params.guid}` };
  }

  const file = store.getFileById(guidRow.file_id);
  let path = file?.path ?? null;
  if (path !== null && path.endsWith(".meta")) {
    path = path.slice(0, -5);
  }
  const response = {
    guid: guidRow.guid,
    path,
    asset_type: guidRow.asset_type,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleSearch(
  store: Store,
  params: { query: string; scope?: "files" | "game_objects" | "scripts" },
): object {
  const results = store.search(params.query, params.scope);

  const response = {
    query: params.query,
    results: results.map((r) => {
      let path: string | undefined;
      let summary: string | undefined;

      if (r.type === "file") {
        const file = store.getFileById(r.id);
        path = file?.path;
        summary = file?.summary_line;
      } else if (r.type === "game_object") {
        // label is the GO name
        path = r.label;
      } else if (r.type === "script") {
        // label is class_name
        path = r.label;
        const script = store.getScriptByClassName(r.label);
        summary = script?.api_summary;
      }

      return {
        type: r.type,
        label: r.label,
        path,
        summary,
        importance: r.importance_score,
      };
    }),
    total: results.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleFindComponents(
  store: Store,
  params: { type: string; scene?: string },
): object {
  let fileId: number | undefined;

  if (params.scene !== undefined) {
    const file = store.getFileByPath(params.scene);
    if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };
    fileId = file.id;
  }

  // Try exact type_name match first (built-in components like Transform, Rigidbody)
  let components = store.getComponentsByType(params.type, fileId);

  // If no results, try resolving as a script class name → GUID → script_guid match
  if (components.length === 0) {
    const script = store.getScriptByClassName(params.type);
    if (script) {
      const scriptFile = store.getFileById(script.file_id);
      if (scriptFile) {
        const metaFile = store.getFileByPath(scriptFile.path + ".meta");
        if (metaFile) {
          const guidRow = store.getGuidByFileId(metaFile.id);
          if (guidRow) {
            components = store.getComponentsByScriptGuid(guidRow.guid, fileId);
          }
        }
      }
    }
  }

  const response = {
    type: params.type,
    components: components.map((c) => {
      const go = store.getGameObjectById(c.game_object_id);
      return {
        game_object_id: c.game_object_id,
        game_object_name: go?.name ?? null,
        field_summary: c.field_summary,
        script_guid: c.script_guid,
      };
    }),
    total: components.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleRecentChanges(
  store: Store,
  params: { since?: string; limit?: number },
): object {
  const limit = params.limit ?? 50;
  const changes = store.getRecentChanges(limit);

  const sinceFilter = params.since;
  const filtered =
    sinceFilter !== undefined ? changes.filter((c) => c.changed_at > sinceFilter) : changes;

  const response = {
    changes: filtered.map((c) => ({
      path: c.path,
      change_type: c.change_type,
      changed_at: c.changed_at,
    })),
    total: filtered.length,
  };
  return { token_hint: estimateTokens(response), ...response };
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, resolveStore: StoreResolver): void {
  const toContent = (obj: object) => ({
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  });

  server.registerTool(
    "get_scene_hierarchy",
    {
      description: "Get the GameObject hierarchy for a scene or prefab file.",
      inputSchema: {
        scene: z.string().describe("Relative path to the scene or prefab file"),
        depth: z.number().int().optional().describe("Max depth to include (0 = roots only)"),
        filter: z.string().optional().describe("Filter by name or tag substring"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetSceneHierarchy(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_prefab_structure",
    {
      description: "Get the GameObject structure for a prefab file.",
      inputSchema: {
        prefab: z.string().describe("Relative path to the prefab file"),
        depth: z.number().int().optional().describe("Max depth to include"),
        filter: z.string().optional().describe("Filter by name or tag substring"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetPrefabStructure(resolveStore(params.project), params)),
  );

  server.registerTool(
    "list_scripts",
    {
      description: "List C# scripts with optional filters.",
      inputSchema: {
        namespace: z.string().optional().describe("Filter by namespace"),
        base_class: z.string().optional().describe("Filter by base class"),
        assembly: z.string().optional().describe("Filter by assembly name"),
        is_monobehaviour: z.boolean().optional().describe("Filter MonoBehaviour scripts only"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleListScripts(resolveStore(params.project), params)),
  );

  server.registerTool(
    "list_assets",
    {
      description: "List Unity asset files (.asset), optionally filtered by type.",
      inputSchema: {
        type: z.string().optional().describe("Filter by asset type name substring"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleListAssets(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_game_object",
    {
      description: "Get full details for a specific GameObject in a scene or prefab.",
      inputSchema: {
        scene: z.string().describe("Relative path to the scene or prefab file"),
        name_or_id: z.string().describe("GameObject name"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetGameObject(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_component",
    {
      description: "Get a specific component on a GameObject.",
      inputSchema: {
        scene: z.string().describe("Relative path to the scene or prefab file"),
        game_object: z.string().describe("GameObject name"),
        component_type: z
          .string()
          .describe('Component type name (e.g. "Rigidbody", "PlayerController")'),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetComponent(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_script_detail",
    {
      description: "Get detailed info about a C# class including all members.",
      inputSchema: {
        class_name: z.string().describe("C# class name"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetScriptDetail(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_script_member",
    {
      description: "Get details about a specific member of a C# class.",
      inputSchema: {
        class_name: z.string().describe("C# class name"),
        member_name: z.string().describe("Member name (field, method, property, etc.)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetScriptMember(resolveStore(params.project), params)),
  );

  server.registerTool(
    "find_references",
    {
      description: "Find all files/objects that reference a given GUID or script class name.",
      inputSchema: {
        guid_or_name: z.string().describe("Asset GUID or script class name"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Traversal depth (1 = direct refs, >1 = transitive via graph)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleFindReferences(resolveStore(params.project), params)),
  );

  server.registerTool(
    "find_dependencies",
    {
      description: "Find all dependencies (outgoing references) of a file, script class, or GUID.",
      inputSchema: {
        guid_or_name: z.string().describe("File path, script class name, or GUID"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Traversal depth (1 = direct deps, >1 = transitive via graph)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleFindDependencies(resolveStore(params.project), params)),
  );

  server.registerTool(
    "resolve_guid",
    {
      description: "Resolve a Unity GUID to a file path and asset type.",
      inputSchema: {
        guid: z.string().describe("Unity asset GUID"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleResolveGuid(resolveStore(params.project), params)),
  );

  server.registerTool(
    "search",
    {
      description: "Search the index for files, GameObjects, or scripts matching a query.",
      inputSchema: {
        query: z.string().describe("Search query"),
        scope: z
          .enum(["files", "game_objects", "scripts"])
          .optional()
          .describe("Limit search to a specific scope"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleSearch(resolveStore(params.project), params)),
  );

  server.registerTool(
    "find_components",
    {
      description: "Find all GameObjects that have a specific component type attached.",
      inputSchema: {
        type: z.string().describe("Component type name"),
        scene: z.string().optional().describe("Limit search to this scene or prefab file"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleFindComponents(resolveStore(params.project), params)),
  );

  server.registerTool(
    "recent_changes",
    {
      description: "Get recently changed files from the change log.",
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp — only return changes after this"),
        limit: z.number().int().optional().describe("Max number of changes to return (default 50)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleRecentChanges(resolveStore(params.project), params)),
  );
}
