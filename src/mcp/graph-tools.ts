import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../db/store.js";
import type { StoreResolver } from "./tools.js";
import { encodeNodeId, decodeNodeId } from "../types.js";
import type { GraphEdgeType } from "../types.js";

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

function resolveNodeLabel(store: Store, nodeId: string): string {
  const { type, id } = decodeNodeId(nodeId);
  switch (type) {
    case "script": {
      const script = store.getScriptById(id);
      return script?.class_name ?? nodeId;
    }
    case "file": {
      const file = store.getFileById(id);
      return file?.path ?? nodeId;
    }
    case "game_object": {
      const go = store.getGameObjectById(id);
      return go?.name ?? nodeId;
    }
    case "assembly": {
      const asm = store.getAssemblyById(id);
      return asm?.name ?? nodeId;
    }
    default:
      return nodeId;
  }
}

function resolveIdentifier(store: Store, identifier: string): string | null {
  // 1. Try as script class_name
  const script = store.getScriptByClassName(identifier);
  if (script) return encodeNodeId("script", script.id);

  // 2. Try as file path
  const file = store.getFileByPath(identifier);
  if (file) return encodeNodeId("file", file.id);

  // 3. Try as literal node ID (e.g., "script:42")
  if (identifier.includes(":")) {
    const decoded = decodeNodeId(identifier);
    if (!Number.isNaN(decoded.id)) return identifier;
  }

  return null;
}

export function handleTraceDependencies(
  store: Store,
  params: { identifier: string; depth?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (nodeId === null) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const depth = Math.min(params.depth ?? 3, 10);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.traceDependencies(nodeId, depth, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
      label: resolveNodeLabel(store, n.id),
    })),
    edges: result.edges,
    summary: `${params.identifier} has ${String(result.nodes.length - 1)} transitive dependencies across ${String(depth)} levels`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleTraceDependents(
  store: Store,
  params: { identifier: string; depth?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (nodeId === null) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const depth = Math.min(params.depth ?? 3, 10);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.traceDependents(nodeId, depth, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
      label: resolveNodeLabel(store, n.id),
    })),
    edges: result.edges,
    summary: `${String(result.nodes.length - 1)} things depend on ${params.identifier} within ${String(depth)} levels`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleFindPath(
  store: Store,
  params: { from: string; to: string; max_depth?: number },
): object {
  const fromNode = resolveIdentifier(store, params.from);
  const toNode = resolveIdentifier(store, params.to);

  if (fromNode === null) return { token_hint: 10, error: `Cannot resolve: ${params.from}` };
  if (toNode === null) return { token_hint: 10, error: `Cannot resolve: ${params.to}` };

  const result = store.graph.findPath(fromNode, toNode);
  if (!result) {
    return {
      token_hint: 10,
      path: null,
      summary: `No path found between ${params.from} and ${params.to}`,
    };
  }

  const response = {
    path: result.nodes.map((nodeId) => ({
      id: nodeId,
      type: decodeNodeId(nodeId).type,
      label: resolveNodeLabel(store, nodeId),
    })),
    edges: result.edges,
    summary: `Path of length ${String(result.nodes.length - 1)} from ${params.from} to ${params.to}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetSubgraph(
  store: Store,
  params: { identifier: string; radius?: number; edge_types?: string[] },
): object {
  const nodeId = resolveIdentifier(store, params.identifier);
  if (nodeId === null) return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };

  const radius = Math.min(params.radius ?? 2, 5);
  const edgeTypes = params.edge_types as GraphEdgeType[] | undefined;
  const result = store.graph.getSubgraph(nodeId, radius, edgeTypes);

  const response = {
    nodes: result.nodes.map((n) => ({
      id: n.id,
      type: decodeNodeId(n.id).type,
      depth: n.depth,
      label: resolveNodeLabel(store, n.id),
    })),
    edges: result.edges,
    summary: `${String(result.nodes.length)} nodes within radius ${String(radius)} of ${params.identifier}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleDetectCycles(
  store: Store,
  params: { edge_types?: string[]; max_length?: number },
): object {
  const edgeTypes = (params.edge_types ?? [
    "INHERITS",
    "CALLS",
    "ASSEMBLY_DEPENDS",
  ]) as GraphEdgeType[];
  const maxLength = params.max_length ?? 10;
  const cycles = store.graph.detectCycles(edgeTypes, maxLength);

  const response = {
    cycles: cycles.map((cycle) => ({
      nodes: cycle,
      length: cycle.length,
    })),
    total: cycles.length,
    summary:
      cycles.length > 0
        ? `Found ${String(cycles.length)} circular dependencies`
        : "No circular dependencies detected",
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function handleGetGraphStats(
  store: Store,
  params: {
    metric: "degree" | "betweenness" | "connected_components";
    top_n?: number;
    edge_types?: string[];
  },
): object {
  const topN = params.top_n ?? 10;
  const rankings = store.graph.getTopNodes(params.metric, topN);

  const response = {
    metric: params.metric,
    rankings,
    summary: `Top ${String(rankings.length)} nodes by ${params.metric}`,
  };
  return { token_hint: estimateTokens(response), ...response };
}

export function registerGraphTools(server: McpServer, resolveStore: StoreResolver): void {
  const toContent = (obj: object) => ({
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  });

  server.registerTool(
    "trace_dependencies",
    {
      description:
        "Trace transitive dependencies of a script, file, or entity. Returns a subgraph.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Script class name, file path, or node ID (e.g. script:42)"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Max traversal depth (default 3)"),
        edge_types: z
          .array(z.string())
          .optional()
          .describe("Filter by edge types (e.g. ['CALLS', 'INHERITS'])"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleTraceDependencies(resolveStore(params.project), params)),
  );

  server.registerTool(
    "trace_dependents",
    {
      description:
        "Find what depends on a script/file transitively. Answers: 'what breaks if I change X?'",
      inputSchema: {
        identifier: z.string().describe("Script class name, file path, or node ID"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Max traversal depth (default 3)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleTraceDependents(resolveStore(params.project), params)),
  );

  server.registerTool(
    "find_path",
    {
      description: "Find the shortest path between two entities in the dependency graph.",
      inputSchema: {
        from: z.string().describe("Start: script class name, file path, or node ID"),
        to: z.string().describe("End: script class name, file path, or node ID"),
        max_depth: z.number().int().optional().describe("Max path length (default 10)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleFindPath(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_subgraph",
    {
      description: "Get the neighborhood subgraph around an entity within a given radius.",
      inputSchema: {
        identifier: z.string().describe("Script class name, file path, or node ID"),
        radius: z.number().int().min(1).max(5).optional().describe("Hop radius (default 2)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetSubgraph(resolveStore(params.project), params)),
  );

  server.registerTool(
    "detect_cycles",
    {
      description: "Detect circular dependencies in the graph.",
      inputSchema: {
        edge_types: z
          .array(z.string())
          .optional()
          .describe("Edge types to check (default: INHERITS, CALLS, ASSEMBLY_DEPENDS)"),
        max_length: z.number().int().optional().describe("Max cycle length to report (default 10)"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleDetectCycles(resolveStore(params.project), params)),
  );

  server.registerTool(
    "get_graph_stats",
    {
      description: "Get graph metrics: most-connected nodes, centrality, or connected components.",
      inputSchema: {
        metric: z
          .enum(["degree", "betweenness", "connected_components"])
          .describe("Which metric to compute"),
        top_n: z.number().int().optional().describe("Number of top results (default 10)"),
        edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
        project: z
          .string()
          .optional()
          .describe("Project name (required if multiple projects indexed)"),
      },
    },
    (params) => toContent(handleGetGraphStats(resolveStore(params.project), params)),
  );
}
