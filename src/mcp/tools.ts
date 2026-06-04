import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../db/store.js';

// ---------------------------------------------------------------------------
// Handler functions (exported for testing)
// ---------------------------------------------------------------------------

export function handleGetSceneHierarchy(
  store: Store,
  params: { scene: string; depth?: number; filter?: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  const allGOs = store.getGameObjectsByFile(file.id);
  const maxDepth = params.depth ?? Infinity;
  const filterLower = params.filter?.toLowerCase();

  const filtered = allGOs.filter(go => {
    if (go.depth > maxDepth) return false;
    if (filterLower) {
      const nameMatch = go.name.toLowerCase().includes(filterLower);
      const tagMatch = go.tag.toLowerCase().includes(filterLower);
      if (!nameMatch && !tagMatch) return false;
    }
    return true;
  });

  const roots = filtered
    .filter(go => go.parent_file_id_local === null)
    .sort((a, b) => b.importance_score - a.importance_score);

  return {
    token_hint: roots.length * 10,
    scene: params.scene,
    roots: roots.map(go => ({
      name: go.name,
      components: go.component_summary,
      children_summary: go.subtree_summary,
      importance: go.importance_score,
      tag: go.tag,
      active: go.active,
    })),
  };
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

  return {
    token_hint: scripts.length * 5,
    scripts: scripts.map(s => ({
      class_name: s.class_name,
      namespace: s.namespace,
      base_class: s.base_class,
      api_summary: s.api_summary,
      is_monobehaviour: s.is_monobehaviour,
      is_generated: s.is_generated,
      complexity: s.complexity_score,
    })),
    total: scripts.length,
  };
}

export function handleListAssets(
  store: Store,
  params: { type?: string },
): object {
  const files = store.listFiles('asset');
  const filtered = params.type
    ? files.filter(f => f.summary_line.toLowerCase().includes(params.type!.toLowerCase()))
    : files;

  return {
    token_hint: filtered.length * 3,
    assets: filtered.map(f => ({
      path: f.path,
      summary: f.summary_line,
    })),
    total: filtered.length,
  };
}

export function handleGetGameObject(
  store: Store,
  params: { scene: string; name_or_id: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  const go = store.getGameObjectByName(file.id, params.name_or_id);
  if (!go) return { token_hint: 10, error: `GameObject not found: ${params.name_or_id}` };

  const components = store.getComponentsByGameObject(go.id);

  return {
    token_hint: 50,
    name: go.name,
    tag: go.tag,
    layer: go.layer,
    active: go.active,
    depth: go.depth,
    child_count: go.child_count,
    importance: go.importance_score,
    components: components.map(c => ({
      type_name: c.type_name,
      script_guid: c.script_guid,
      field_summary: c.field_summary,
      serialized_fields: JSON.parse(c.serialized_fields) as unknown,
    })),
  };
}

export function handleGetComponent(
  store: Store,
  params: { scene: string; game_object: string; component_type: string },
): object {
  const file = store.getFileByPath(params.scene);
  if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };

  const go = store.getGameObjectByName(file.id, params.game_object);
  if (!go) return { token_hint: 10, error: `GameObject not found: ${params.game_object}` };

  const components = store.getComponentsByGameObject(go.id);
  const comp = components.find(c =>
    c.type_name.toLowerCase() === params.component_type.toLowerCase(),
  );

  if (!comp) {
    return {
      token_hint: 10,
      error: `Component '${params.component_type}' not found on '${params.game_object}'`,
    };
  }

  return {
    token_hint: 30,
    game_object: go.name,
    type_name: comp.type_name,
    script_guid: comp.script_guid,
    field_summary: comp.field_summary,
    serialized_fields: JSON.parse(comp.serialized_fields) as unknown,
  };
}

export function handleGetScriptDetail(
  store: Store,
  params: { class_name: string },
): object {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) {
    return { token_hint: 10, error: `Script not found: ${params.class_name}` };
  }

  const members = store.getScriptMembers(script.id);

  return {
    token_hint: 20 + members.length * 5,
    class_name: script.class_name,
    namespace: script.namespace,
    base_class: script.base_class,
    interfaces: JSON.parse(script.interfaces) as string[],
    assembly_name: script.assembly_name,
    api_summary: script.api_summary,
    is_monobehaviour: script.is_monobehaviour,
    is_editor_script: script.is_editor_script,
    is_scriptable_object: script.is_scriptable_object,
    is_generated: script.is_generated,
    complexity: script.complexity_score,
    members: members.map(m => ({
      name: m.name,
      kind: m.kind,
      access: m.access,
      signature: m.signature,
      attributes: JSON.parse(m.attributes) as string[],
      has_serialize_field: m.has_serialize_field,
    })),
  };
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
  const member = members.find(
    m => m.name.toLowerCase() === params.member_name.toLowerCase(),
  );

  if (!member) {
    return {
      token_hint: 10,
      error: `Member '${params.member_name}' not found in '${params.class_name}'`,
    };
  }

  return {
    token_hint: 15,
    class_name: script.class_name,
    name: member.name,
    kind: member.kind,
    access: member.access,
    return_type: member.return_type,
    parameters: JSON.parse(member.parameters) as unknown,
    attributes: JSON.parse(member.attributes) as string[],
    signature: member.signature,
    has_serialize_field: member.has_serialize_field,
    has_header_attr: member.has_header_attr,
  };
}

export function handleFindReferences(
  store: Store,
  params: { guid_or_name: string },
): object {
  let guid = params.guid_or_name;

  // Heuristic: if it looks like a name (short, has dots/uppercase), resolve to GUID first
  const looksLikeName =
    guid.length < 32 ||
    guid.includes('.') ||
    /[A-Z]/.test(guid);

  if (looksLikeName) {
    // Try to find a script with this class name and resolve its GUID
    const script = store.getScriptByClassName(guid);
    if (script) {
      const fileRow = store.getFileById(script.file_id);
      if (fileRow) {
        const metaPath = fileRow.path + '.meta';
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

  return {
    token_hint: refs.length * 5,
    guid,
    references: refs.map(r => {
      const sourceFile = store.getFileById(r.source_file_id);
      return {
        source_file: sourceFile?.path ?? `file_id:${r.source_file_id}`,
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
    total: refs.length,
  };
}

export function handleFindDependencies(
  store: Store,
  params: { guid_or_name: string },
): object {
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

  return {
    token_hint: refs.length * 5,
    source: params.guid_or_name,
    dependencies: refs.map(r => {
      const targetFile = r.target_file_id ? store.getFileById(r.target_file_id) : null;
      return {
        target_guid: r.target_guid,
        target_file: targetFile?.path ?? null,
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
    total: refs.length,
  };
}

export function handleResolveGuid(
  store: Store,
  params: { guid: string },
): object {
  const guidRow = store.resolveGuid(params.guid);
  if (!guidRow) {
    return { token_hint: 10, error: `GUID not found: ${params.guid}` };
  }

  const file = store.getFileById(guidRow.file_id);
  let path = file?.path ?? null;
  if (path?.endsWith('.meta')) {
    path = path.slice(0, -5);
  }
  return {
    token_hint: 10,
    guid: guidRow.guid,
    path,
    asset_type: guidRow.asset_type,
  };
}

export function handleSearch(
  store: Store,
  params: { query: string; scope?: 'files' | 'game_objects' | 'scripts' },
): object {
  const results = store.search(params.query, params.scope);

  return {
    token_hint: results.length * 3,
    query: params.query,
    results: results.map(r => {
      let path: string | undefined;
      let summary: string | undefined;

      if (r.type === 'file') {
        const file = store.getFileById(r.id);
        path = file?.path;
        summary = file?.summary_line;
      } else if (r.type === 'game_object') {
        // label is the GO name
        path = r.label;
      } else if (r.type === 'script') {
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
}

export function handleFindComponents(
  store: Store,
  params: { type: string; scene?: string },
): object {
  let fileId: number | undefined;

  if (params.scene) {
    const file = store.getFileByPath(params.scene);
    if (!file) return { token_hint: 10, error: `File not found: ${params.scene}` };
    fileId = file.id;
  }

  const components = store.getComponentsByType(params.type, fileId);

  return {
    token_hint: components.length * 5,
    type: params.type,
    components: components.map(c => {
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
}

export function handleRecentChanges(
  store: Store,
  params: { since?: string; limit?: number },
): object {
  const limit = params.limit ?? 50;
  const changes = store.getRecentChanges(limit);

  const filtered = params.since
    ? changes.filter(c => c.changed_at > params.since!)
    : changes;

  return {
    token_hint: filtered.length * 3,
    changes: filtered.map(c => ({
      path: c.path,
      change_type: c.change_type,
      changed_at: c.changed_at,
    })),
    total: filtered.length,
  };
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, store: Store): void {
  const toContent = (obj: object) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
  });

  server.tool(
    'get_scene_hierarchy',
    'Get the GameObject hierarchy for a scene or prefab file.',
    {
      scene: z.string().describe('Relative path to the scene or prefab file'),
      depth: z.number().int().optional().describe('Max depth to include (0 = roots only)'),
      filter: z.string().optional().describe('Filter by name or tag substring'),
    },
    async (params) => toContent(handleGetSceneHierarchy(store, params)),
  );

  server.tool(
    'get_prefab_structure',
    'Get the GameObject structure for a prefab file.',
    {
      prefab: z.string().describe('Relative path to the prefab file'),
      depth: z.number().int().optional().describe('Max depth to include'),
      filter: z.string().optional().describe('Filter by name or tag substring'),
    },
    async (params) => toContent(handleGetPrefabStructure(store, params)),
  );

  server.tool(
    'list_scripts',
    'List C# scripts with optional filters.',
    {
      namespace: z.string().optional().describe('Filter by namespace'),
      base_class: z.string().optional().describe('Filter by base class'),
      assembly: z.string().optional().describe('Filter by assembly name'),
      is_monobehaviour: z.boolean().optional().describe('Filter MonoBehaviour scripts only'),
    },
    async (params) => toContent(handleListScripts(store, params)),
  );

  server.tool(
    'list_assets',
    'List Unity asset files (.asset), optionally filtered by type.',
    {
      type: z.string().optional().describe('Filter by asset type name substring'),
    },
    async (params) => toContent(handleListAssets(store, params)),
  );

  server.tool(
    'get_game_object',
    'Get full details for a specific GameObject in a scene or prefab.',
    {
      scene: z.string().describe('Relative path to the scene or prefab file'),
      name_or_id: z.string().describe('GameObject name'),
    },
    async (params) => toContent(handleGetGameObject(store, params)),
  );

  server.tool(
    'get_component',
    'Get a specific component on a GameObject.',
    {
      scene: z.string().describe('Relative path to the scene or prefab file'),
      game_object: z.string().describe('GameObject name'),
      component_type: z.string().describe('Component type name (e.g. "Rigidbody", "PlayerController")'),
    },
    async (params) => toContent(handleGetComponent(store, params)),
  );

  server.tool(
    'get_script_detail',
    'Get detailed info about a C# class including all members.',
    {
      class_name: z.string().describe('C# class name'),
    },
    async (params) => toContent(handleGetScriptDetail(store, params)),
  );

  server.tool(
    'get_script_member',
    'Get details about a specific member of a C# class.',
    {
      class_name: z.string().describe('C# class name'),
      member_name: z.string().describe('Member name (field, method, property, etc.)'),
    },
    async (params) => toContent(handleGetScriptMember(store, params)),
  );

  server.tool(
    'find_references',
    'Find all files/objects that reference a given GUID or script class name.',
    {
      guid_or_name: z.string().describe('Asset GUID or script class name'),
    },
    async (params) => toContent(handleFindReferences(store, params)),
  );

  server.tool(
    'find_dependencies',
    'Find all dependencies (outgoing references) of a file, script class, or GUID.',
    {
      guid_or_name: z.string().describe('File path, script class name, or GUID'),
    },
    async (params) => toContent(handleFindDependencies(store, params)),
  );

  server.tool(
    'resolve_guid',
    'Resolve a Unity GUID to a file path and asset type.',
    {
      guid: z.string().describe('Unity asset GUID'),
    },
    async (params) => toContent(handleResolveGuid(store, params)),
  );

  server.tool(
    'search',
    'Search the index for files, GameObjects, or scripts matching a query.',
    {
      query: z.string().describe('Search query'),
      scope: z
        .enum(['files', 'game_objects', 'scripts'])
        .optional()
        .describe('Limit search to a specific scope'),
    },
    async (params) => toContent(handleSearch(store, params)),
  );

  server.tool(
    'find_components',
    'Find all GameObjects that have a specific component type attached.',
    {
      type: z.string().describe('Component type name'),
      scene: z.string().optional().describe('Limit search to this scene or prefab file'),
    },
    async (params) => toContent(handleFindComponents(store, params)),
  );

  server.tool(
    'recent_changes',
    'Get recently changed files from the change log.',
    {
      since: z.string().optional().describe('ISO 8601 timestamp — only return changes after this'),
      limit: z.number().int().optional().describe('Max number of changes to return (default 50)'),
    },
    async (params) => toContent(handleRecentChanges(store, params)),
  );
}
