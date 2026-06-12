import type { GraphEdgeRow, GraphEdgeType } from "../types.js";
export interface GraphNeighbor {
    nodeId: string;
    edgeType: GraphEdgeType;
}
export interface SubgraphResult {
    nodes: Array<{
        id: string;
        depth: number;
    }>;
    edges: Array<{
        source: string;
        target: string;
        type: GraphEdgeType;
    }>;
}
export interface PathResult {
    nodes: string[];
    edges: Array<{
        source: string;
        target: string;
        type: GraphEdgeType;
    }>;
}
export interface TopNodeResult {
    nodeId: string;
    score: number;
}
export declare class GraphManager {
    private g;
    constructor();
    /** Clear the in-memory graph and reload from SQLite rows. */
    hydrate(edges: (GraphEdgeRow & {
        id?: number;
    })[]): void;
    /**
     * Remove all edges that belonged to `fileId`, then add the new set.
     * The `oldEdges` param is accepted for API compatibility but the graph
     * actually tracks file ownership via edge attributes, so we scan for
     * all edges with source_file_id === fileId and drop them.
     */
    patchForFile(fileId: number, _oldEdges: GraphEdgeRow[], newEdges: GraphEdgeRow[]): void;
    nodeCount(): number;
    edgeCount(): number;
    /** Outgoing neighbors (what this node depends on). */
    getOutgoing(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[];
    /** Incoming neighbors (what depends on this node). */
    getIncoming(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[];
    /**
     * BFS forward traversal — returns nodes reachable from startNode up to
     * maxDepth hops (inclusive of start node at depth 0).
     */
    traceDependencies(startNode: string, maxDepth: number, edgeTypes?: GraphEdgeType[]): SubgraphResult;
    /**
     * BFS reverse traversal — returns nodes that transitively depend on startNode.
     */
    traceDependents(startNode: string, maxDepth: number, edgeTypes?: GraphEdgeType[]): SubgraphResult;
    /**
     * Returns a neighbourhood subgraph centred on a node, exploring both
     * directions up to `radius` hops.
     */
    getSubgraph(centerNode: string, radius: number, edgeTypes?: GraphEdgeType[]): SubgraphResult;
    /** Find shortest directed path from `from` to `to`. Returns null if unreachable. */
    findPath(from: string, to: string): PathResult | null;
    /**
     * DFS-based cycle detection. Returns an array of cycles, each cycle being
     * an array of node IDs that form the cycle.
     */
    detectCycles(edgeTypes?: GraphEdgeType[], maxLength?: number): string[][];
    /**
     * Returns the top N nodes by the given metric.
     * Supported metrics: "degree" (out-degree), "betweenness", "connected_components".
     */
    getTopNodes(metric: "degree" | "betweenness" | "connected_components", topN: number): TopNodeResult[];
    private addEdgeRow;
    private bfs;
}
