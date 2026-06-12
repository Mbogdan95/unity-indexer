import { MultiDirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";
import { connectedComponents } from "graphology-components";
import { encodeNodeId } from "../types.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function edgeKey(src, tgt, edgeType) {
    return `${src}->${tgt}:${edgeType}`;
}
// ---------------------------------------------------------------------------
// GraphManager
// ---------------------------------------------------------------------------
export class GraphManager {
    g;
    constructor() {
        this.g = new MultiDirectedGraph();
    }
    // -------------------------------------------------------------------------
    // Hydration
    // -------------------------------------------------------------------------
    /** Clear the in-memory graph and reload from SQLite rows. */
    hydrate(edges) {
        this.g.clear();
        for (const edge of edges) {
            this.addEdgeRow(edge);
        }
    }
    // -------------------------------------------------------------------------
    // Incremental patching
    // -------------------------------------------------------------------------
    /**
     * Remove all edges that belonged to `fileId`, then add the new set.
     * The `oldEdges` param is accepted for API compatibility but the graph
     * actually tracks file ownership via edge attributes, so we scan for
     * all edges with source_file_id === fileId and drop them.
     */
    patchForFile(fileId, _oldEdges, newEdges) {
        // Collect edge keys to remove
        const toRemove = [];
        this.g.forEachEdge((key, attrs) => {
            if (attrs.source_file_id === fileId) {
                toRemove.push(key);
            }
        });
        for (const key of toRemove) {
            this.g.dropEdge(key);
        }
        // Prune orphan nodes (no edges remaining)
        const orphans = [];
        this.g.forEachNode((node) => {
            if (this.g.degree(node) === 0) {
                orphans.push(node);
            }
        });
        for (const node of orphans) {
            this.g.dropNode(node);
        }
        // Add new edges
        for (const edge of newEdges) {
            this.addEdgeRow(edge);
        }
    }
    // -------------------------------------------------------------------------
    // Basic stats
    // -------------------------------------------------------------------------
    nodeCount() {
        return this.g.order;
    }
    edgeCount() {
        return this.g.size;
    }
    // -------------------------------------------------------------------------
    // Neighbors
    // -------------------------------------------------------------------------
    /** Outgoing neighbors (what this node depends on). */
    getOutgoing(nodeId, edgeTypes) {
        if (!this.g.hasNode(nodeId))
            return [];
        const result = [];
        this.g.forEachOutEdge(nodeId, (_key, attrs, _src, target) => {
            if (!edgeTypes || edgeTypes.includes(attrs.type)) {
                result.push({ nodeId: target, edgeType: attrs.type });
            }
        });
        return result;
    }
    /** Incoming neighbors (what depends on this node). */
    getIncoming(nodeId, edgeTypes) {
        if (!this.g.hasNode(nodeId))
            return [];
        const result = [];
        this.g.forEachInEdge(nodeId, (_key, attrs, source) => {
            if (!edgeTypes || edgeTypes.includes(attrs.type)) {
                result.push({ nodeId: source, edgeType: attrs.type });
            }
        });
        return result;
    }
    // -------------------------------------------------------------------------
    // BFS traversals
    // -------------------------------------------------------------------------
    /**
     * BFS forward traversal — returns nodes reachable from startNode up to
     * maxDepth hops (inclusive of start node at depth 0).
     */
    traceDependencies(startNode, maxDepth, edgeTypes) {
        return this.bfs(startNode, maxDepth, "forward", edgeTypes);
    }
    /**
     * BFS reverse traversal — returns nodes that transitively depend on startNode.
     */
    traceDependents(startNode, maxDepth, edgeTypes) {
        return this.bfs(startNode, maxDepth, "reverse", edgeTypes);
    }
    /**
     * Returns a neighbourhood subgraph centred on a node, exploring both
     * directions up to `radius` hops.
     */
    getSubgraph(centerNode, radius, edgeTypes) {
        // Forward BFS + reverse BFS, then merge
        const forward = this.bfs(centerNode, radius, "forward", edgeTypes);
        const reverse = this.bfs(centerNode, radius, "reverse", edgeTypes);
        const nodeMap = new Map();
        for (const n of forward.nodes)
            nodeMap.set(n.id, n.depth);
        for (const n of reverse.nodes) {
            if (!nodeMap.has(n.id))
                nodeMap.set(n.id, n.depth);
        }
        const edgeSet = new Set();
        const edges = [];
        const addEdges = (list) => {
            for (const e of list) {
                const key = `${e.source}->${e.target}:${e.type}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push(e);
                }
            }
        };
        addEdges(forward.edges);
        addEdges(reverse.edges);
        return {
            nodes: Array.from(nodeMap.entries()).map(([id, depth]) => ({ id, depth })),
            edges,
        };
    }
    // -------------------------------------------------------------------------
    // Shortest path
    // -------------------------------------------------------------------------
    /** Find shortest directed path from `from` to `to`. Returns null if unreachable. */
    findPath(from, to) {
        if (!this.g.hasNode(from) || !this.g.hasNode(to))
            return null;
        const nodePath = bidirectional(this.g, from, to);
        if (!nodePath)
            return null;
        const edges = [];
        for (let i = 0; i < nodePath.length - 1; i++) {
            const src = nodePath[i];
            const tgt = nodePath[i + 1];
            // Get the edge type from the first edge between these two nodes
            const edgeKeys = this.g.edges(src, tgt);
            if (edgeKeys.length > 0) {
                const attrs = this.g.getEdgeAttributes(edgeKeys[0]);
                edges.push({ source: src, target: tgt, type: attrs.type });
            }
        }
        return { nodes: nodePath, edges };
    }
    // -------------------------------------------------------------------------
    // Cycle detection
    // -------------------------------------------------------------------------
    /**
     * DFS-based cycle detection. Returns an array of cycles, each cycle being
     * an array of node IDs that form the cycle.
     */
    detectCycles(edgeTypes, maxLength = 20) {
        const cycles = [];
        const visited = new Set();
        const stack = [];
        const onStack = new Set();
        const dfs = (node) => {
            visited.add(node);
            onStack.add(node);
            stack.push(node);
            this.g.forEachOutEdge(node, (_key, attrs, _src, neighbor) => {
                if (edgeTypes && !edgeTypes.includes(attrs.type))
                    return;
                if (stack.length > maxLength)
                    return;
                if (!visited.has(neighbor)) {
                    dfs(neighbor);
                }
                else if (onStack.has(neighbor)) {
                    // Found a cycle — extract the cycle portion from the stack
                    const cycleStart = stack.indexOf(neighbor);
                    if (cycleStart !== -1) {
                        const cycle = stack.slice(cycleStart);
                        cycles.push([...cycle]);
                    }
                }
            });
            stack.pop();
            onStack.delete(node);
        };
        this.g.forEachNode((node) => {
            if (!visited.has(node)) {
                dfs(node);
            }
        });
        return cycles;
    }
    // -------------------------------------------------------------------------
    // Top nodes by metric
    // -------------------------------------------------------------------------
    /**
     * Returns the top N nodes by the given metric.
     * Supported metrics: "degree" (out-degree), "betweenness", "connected_components".
     */
    getTopNodes(metric, topN) {
        const scores = new Map();
        if (metric === "degree") {
            this.g.forEachNode((node) => {
                scores.set(node, this.g.outDegree(node));
            });
        }
        else if (metric === "betweenness") {
            // Use a simple approximation: node appears in many paths
            // For correctness we could use graphology-metrics betweenness, but
            // it requires an undirected graph or additional setup. Use out-degree
            // as a proxy for now.
            this.g.forEachNode((node) => {
                scores.set(node, this.g.outDegree(node) + this.g.inDegree(node));
            });
        }
        else {
            // Score each node by the size of its connected component
            const components = connectedComponents(this.g);
            for (const component of components) {
                const size = component.length;
                for (const node of component) {
                    scores.set(node, size);
                }
            }
        }
        return Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN)
            .map(([nodeId, score]) => ({ nodeId, score }));
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    addEdgeRow(edge) {
        const src = encodeNodeId(edge.source_type, edge.source_id);
        const tgt = encodeNodeId(edge.target_type, edge.target_id);
        const key = edgeKey(src, tgt, edge.edge_type);
        if (!this.g.hasNode(src))
            this.g.addNode(src);
        if (!this.g.hasNode(tgt))
            this.g.addNode(tgt);
        if (!this.g.hasEdge(key)) {
            this.g.addEdgeWithKey(key, src, tgt, {
                type: edge.edge_type,
                metadata: edge.metadata,
                source_file_id: edge.source_file_id,
            });
        }
    }
    bfs(startNode, maxDepth, direction, edgeTypes) {
        const nodes = [];
        const edges = [];
        if (!this.g.hasNode(startNode)) {
            return { nodes, edges };
        }
        const visitedNodes = new Set();
        const visitedEdges = new Set();
        const queue = [{ node: startNode, depth: 0 }];
        visitedNodes.add(startNode);
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry)
                break;
            const { node, depth } = entry;
            nodes.push({ id: node, depth });
            if (depth >= maxDepth)
                continue;
            const iterFn = direction === "forward"
                ? (cb) => {
                    this.g.forEachOutEdge(node, cb);
                }
                : (cb) => {
                    this.g.forEachInEdge(node, (key, attrs, src) => {
                        cb(key, attrs, src, node);
                    });
                };
            iterFn((key, attrs, src, tgt) => {
                if (edgeTypes && !edgeTypes.includes(attrs.type))
                    return;
                const neighbor = direction === "forward" ? tgt : src;
                const edgeId = direction === "forward" ? key : key;
                if (!visitedEdges.has(edgeId)) {
                    visitedEdges.add(edgeId);
                    edges.push({
                        source: direction === "forward" ? node : src,
                        target: direction === "forward" ? neighbor : node,
                        type: attrs.type,
                    });
                }
                if (!visitedNodes.has(neighbor)) {
                    visitedNodes.add(neighbor);
                    queue.push({ node: neighbor, depth: depth + 1 });
                }
            });
        }
        return { nodes, edges };
    }
}
//# sourceMappingURL=graph.js.map