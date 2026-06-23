import { z } from "zod";
import { encodeNodeId, decodeNodeId } from "../types.js";
function estimateTokens(obj) {
    return Math.ceil(JSON.stringify(obj).length / 4);
}
function resolveNodeInfo(store, nodeId) {
    const { type, id } = decodeNodeId(nodeId);
    switch (type) {
        case "script": {
            const script = store.getScriptById(id);
            if (!script)
                return { label: nodeId };
            const file = store.getFileById(script.file_id);
            return {
                label: script.class_name,
                file_path: file ? store.prefixPath(file.path) : undefined,
            };
        }
        case "file": {
            const file = store.getFileById(id);
            return { label: file ? store.prefixPath(file.path) : nodeId };
        }
        case "game_object": {
            const go = store.getGameObjectById(id);
            return { label: go?.name ?? nodeId };
        }
        case "assembly": {
            const asm = store.getAssemblyById(id);
            return { label: asm?.name ?? nodeId };
        }
        default:
            return { label: nodeId };
    }
}
function resolveIdentifier(store, identifier) {
    // 1. Try as script class_name
    const script = store.getScriptByClassName(identifier);
    if (script)
        return encodeNodeId("script", script.id);
    // 2. Try as file path (strip prefix if agent passed a prefixed path)
    const file = store.getFileByPath(store.stripPrefix(identifier));
    if (file)
        return encodeNodeId("file", file.id);
    // 3. Try as literal node ID (e.g., "script:42")
    if (identifier.includes(":")) {
        const decoded = decodeNodeId(identifier);
        if (!Number.isNaN(decoded.id))
            return identifier;
    }
    return null;
}
export function handleTraceDependencies(store, params) {
    const nodeId = resolveIdentifier(store, params.identifier);
    if (nodeId === null)
        return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };
    const depth = Math.min(params.depth ?? 3, 10);
    const edgeTypes = params.edge_types;
    const result = store.graph.traceDependencies(nodeId, depth, edgeTypes);
    const response = {
        nodes: result.nodes.map((n) => {
            const { type } = decodeNodeId(n.id);
            const info = resolveNodeInfo(store, n.id);
            return {
                id: n.id,
                type,
                depth: n.depth,
                label: info.label,
                ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
            };
        }),
        edges: result.edges,
        summary: `${params.identifier} has ${String(result.nodes.length - 1)} transitive dependencies across ${String(depth)} levels`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleTraceDependents(store, params) {
    const nodeId = resolveIdentifier(store, params.identifier);
    if (nodeId === null)
        return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };
    const depth = Math.min(params.depth ?? 3, 10);
    const edgeTypes = params.edge_types;
    const result = store.graph.traceDependents(nodeId, depth, edgeTypes);
    const response = {
        nodes: result.nodes.map((n) => {
            const { type } = decodeNodeId(n.id);
            const info = resolveNodeInfo(store, n.id);
            return {
                id: n.id,
                type,
                depth: n.depth,
                label: info.label,
                ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
            };
        }),
        edges: result.edges,
        summary: `${String(result.nodes.length - 1)} things depend on ${params.identifier} within ${String(depth)} levels`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleFindPath(store, params) {
    const fromNode = resolveIdentifier(store, params.from);
    const toNode = resolveIdentifier(store, params.to);
    if (fromNode === null)
        return { token_hint: 10, error: `Cannot resolve: ${params.from}` };
    if (toNode === null)
        return { token_hint: 10, error: `Cannot resolve: ${params.to}` };
    const result = store.graph.findPath(fromNode, toNode);
    if (!result) {
        return {
            token_hint: 10,
            path: null,
            summary: `No path found between ${params.from} and ${params.to}`,
        };
    }
    const response = {
        path: result.nodes.map((nodeId) => {
            const { type } = decodeNodeId(nodeId);
            const info = resolveNodeInfo(store, nodeId);
            return {
                id: nodeId,
                type,
                label: info.label,
                ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
            };
        }),
        edges: result.edges,
        summary: `Path of length ${String(result.nodes.length - 1)} from ${params.from} to ${params.to}`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleGetSubgraph(store, params) {
    const nodeId = resolveIdentifier(store, params.identifier);
    if (nodeId === null)
        return { token_hint: 10, error: `Cannot resolve: ${params.identifier}` };
    const radius = Math.min(params.radius ?? 2, 5);
    const edgeTypes = params.edge_types;
    const result = store.graph.getSubgraph(nodeId, radius, edgeTypes);
    const response = {
        nodes: result.nodes.map((n) => {
            const { type } = decodeNodeId(n.id);
            const info = resolveNodeInfo(store, n.id);
            return {
                id: n.id,
                type,
                depth: n.depth,
                label: info.label,
                ...(info.file_path !== undefined ? { file_path: info.file_path } : {}),
            };
        }),
        edges: result.edges,
        summary: `${String(result.nodes.length)} nodes within radius ${String(radius)} of ${params.identifier}`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleDetectCycles(store, params) {
    const edgeTypes = (params.edge_types ?? [
        "INHERITS",
        "CALLS",
        "ASSEMBLY_DEPENDS",
    ]);
    const maxLength = params.max_length ?? 10;
    const maxCycles = params.max_cycles ?? 200;
    const { cycles, truncated } = store.graph.detectCycles(edgeTypes, maxLength, maxCycles);
    const response = {
        cycles: cycles.map((cycle) => ({
            nodes: cycle,
            length: cycle.length,
        })),
        total: cycles.length,
        truncated,
        summary: cycles.length > 0
            ? `Found ${String(cycles.length)} circular dependencies${truncated ? " (result capped — increase max_cycles to see more)" : ""}`
            : "No circular dependencies detected",
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleGetGraphStats(store, params) {
    const topN = params.top_n ?? 10;
    const rankings = store.graph.getTopNodes(params.metric, topN);
    const response = {
        metric: params.metric,
        rankings,
        summary: `Top ${String(rankings.length)} nodes by ${params.metric}`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function handleFindImplementors(store, params) {
    const script = store.getScriptByClassName(params.interface_name);
    if (!script) {
        return { token_hint: 10, error: `Script not found: ${params.interface_name}` };
    }
    const nodeId = encodeNodeId("script", script.id);
    const incoming = store.graph.getIncoming(nodeId, ["IMPLEMENTS"]);
    const implementors = incoming
        .map((n) => {
        const { type, id } = decodeNodeId(n.nodeId);
        if (type !== "script")
            return null;
        const implScript = store.getScriptById(id);
        if (!implScript)
            return null;
        const file = store.getFileById(implScript.file_id);
        return {
            class_name: implScript.class_name,
            file_path: store.prefixPath(file?.path ?? ""),
            ...(implScript.namespace ? { namespace: implScript.namespace } : {}),
        };
    })
        .filter((x) => x !== null);
    const response = {
        interface_name: params.interface_name,
        implementors,
        total: implementors.length,
        summary: `Found ${String(implementors.length)} implementor(s) of ${params.interface_name}`,
    };
    return { token_hint: estimateTokens(response), ...response };
}
export function registerGraphTools(server, resolveStore) {
    const toContent = (obj) => ({
        content: [{ type: "text", text: JSON.stringify(obj) }],
    });
    server.registerTool("trace_dependencies", {
        description: "Trace transitive dependencies of a script, file, or entity. Returns a subgraph.",
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
    }, (params) => toContent(handleTraceDependencies(resolveStore(params.project), params)));
    server.registerTool("trace_dependents", {
        description: "Find what depends on a script/file transitively. Answers: 'what breaks if I change X?'",
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
    }, (params) => toContent(handleTraceDependents(resolveStore(params.project), params)));
    server.registerTool("find_path", {
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
    }, (params) => toContent(handleFindPath(resolveStore(params.project), params)));
    server.registerTool("get_subgraph", {
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
    }, (params) => toContent(handleGetSubgraph(resolveStore(params.project), params)));
    server.registerTool("detect_cycles", {
        description: "Detect circular dependencies in the graph. Returns cycles up to max_cycles (default 200); response includes truncated:true when the cap is hit — increase max_cycles to see more.",
        inputSchema: {
            edge_types: z
                .array(z.string())
                .optional()
                .describe("Edge types to check (default: INHERITS, CALLS, ASSEMBLY_DEPENDS)"),
            max_length: z.number().int().optional().describe("Max cycle length to report (default 10)"),
            max_cycles: z
                .number()
                .int()
                .optional()
                .describe("Max number of cycles to return (default 200); response includes truncated:true if capped"),
            project: z
                .string()
                .optional()
                .describe("Project name (required if multiple projects indexed)"),
        },
    }, (params) => toContent(handleDetectCycles(resolveStore(params.project), params)));
    server.registerTool("get_graph_stats", {
        description: "Get graph metrics: most-connected nodes, centrality, or connected components. Use 'degree' for out-degree hubs, 'degree_centrality' for total-degree hubs (most referenced + referencing), 'connected_components' for nodes in the largest dependency clusters. 'betweenness' is a backward-compatible alias for 'degree_centrality'.",
        inputSchema: {
            metric: z
                .enum(["degree", "degree_centrality", "betweenness", "connected_components"])
                .describe("Metric: 'degree' = out-degree, 'degree_centrality' = total degree (in+out), 'betweenness' = alias for degree_centrality, 'connected_components' = component size"),
            top_n: z.number().int().optional().describe("Number of top results (default 10)"),
            edge_types: z.array(z.string()).optional().describe("Filter by edge types"),
            project: z
                .string()
                .optional()
                .describe("Project name (required if multiple projects indexed)"),
        },
    }, (params) => toContent(handleGetGraphStats(resolveStore(params.project), params)));
    server.registerTool("find_implementors", {
        description: "Find all classes that implement a given interface. Answers: 'who implements IMyInterface?'",
        inputSchema: {
            interface_name: z.string().describe("Interface class name (e.g. 'ISceneLoader')"),
            project: z
                .string()
                .optional()
                .describe("Project name (required if multiple projects indexed)"),
        },
    }, (params) => toContent(handleFindImplementors(resolveStore(params.project), params)));
}
//# sourceMappingURL=graph-tools.js.map