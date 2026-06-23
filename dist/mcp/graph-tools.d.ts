import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../db/store.js";
import type { StoreResolver } from "./tools.js";
export declare function handleTraceDependencies(store: Store, params: {
    identifier: string;
    depth?: number;
    edge_types?: string[];
}): object;
export declare function handleTraceDependents(store: Store, params: {
    identifier: string;
    depth?: number;
    edge_types?: string[];
}): object;
export declare function handleFindPath(store: Store, params: {
    from: string;
    to: string;
    max_depth?: number;
}): object;
export declare function handleGetSubgraph(store: Store, params: {
    identifier: string;
    radius?: number;
    edge_types?: string[];
}): object;
export declare function handleDetectCycles(store: Store, params: {
    edge_types?: string[];
    max_length?: number;
    max_cycles?: number;
}): object;
export declare function handleGetGraphStats(store: Store, params: {
    metric: "degree" | "degree_centrality" | "betweenness" | "connected_components";
    top_n?: number;
    edge_types?: string[];
}): object;
export declare function handleFindImplementors(store: Store, params: {
    interface_name: string;
}): object;
export declare function registerGraphTools(server: McpServer, resolveStore: StoreResolver): void;
