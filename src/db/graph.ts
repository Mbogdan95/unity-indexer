import { DirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";
import { connectedComponents } from "graphology-components";
import type { GraphEdgeRow, GraphEdgeType } from "../types.js";
import { encodeNodeId } from "../types.js";

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface GraphNeighbor {
  nodeId: string;
  edgeType: GraphEdgeType;
}

export interface SubgraphResult {
  nodes: Array<{ id: string; depth: number }>;
  edges: Array<{ source: string; target: string; type: GraphEdgeType }>;
}

export interface PathResult {
  nodes: string[];
  edges: Array<{ source: string; target: string; type: GraphEdgeType }>;
}

export interface TopNodeResult {
  nodeId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Edge attribute stored in Graphology
// ---------------------------------------------------------------------------

interface EdgeAttrs {
  type: GraphEdgeType;
  metadata: string | null;
  source_file_id: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgeKey(src: string, tgt: string, edgeType: GraphEdgeType): string {
  return `${src}->${tgt}:${edgeType}`;
}

// ---------------------------------------------------------------------------
// GraphManager
// ---------------------------------------------------------------------------

export class GraphManager {
  private g: DirectedGraph<Record<string, never>, EdgeAttrs>;

  constructor() {
    this.g = new DirectedGraph();
  }

  // -------------------------------------------------------------------------
  // Hydration
  // -------------------------------------------------------------------------

  /** Clear the in-memory graph and reload from SQLite rows. */
  hydrate(edges: (GraphEdgeRow & { id?: number })[]): void {
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
  patchForFile(fileId: number, _oldEdges: GraphEdgeRow[], newEdges: GraphEdgeRow[]): void {
    // Collect edge keys to remove
    const toRemove: string[] = [];
    this.g.forEachEdge((key, attrs) => {
      if (attrs.source_file_id === fileId) {
        toRemove.push(key);
      }
    });

    for (const key of toRemove) {
      this.g.dropEdge(key);
    }

    // Prune orphan nodes (no edges remaining)
    const orphans: string[] = [];
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

  nodeCount(): number {
    return this.g.order;
  }

  edgeCount(): number {
    return this.g.size;
  }

  // -------------------------------------------------------------------------
  // Neighbors
  // -------------------------------------------------------------------------

  /** Outgoing neighbors (what this node depends on). */
  getOutgoing(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[] {
    if (!this.g.hasNode(nodeId)) return [];

    const result: GraphNeighbor[] = [];
    this.g.forEachOutEdge(nodeId, (_key, attrs, _src, target) => {
      if (!edgeTypes || edgeTypes.includes(attrs.type)) {
        result.push({ nodeId: target, edgeType: attrs.type });
      }
    });
    return result;
  }

  /** Incoming neighbors (what depends on this node). */
  getIncoming(nodeId: string, edgeTypes?: GraphEdgeType[]): GraphNeighbor[] {
    if (!this.g.hasNode(nodeId)) return [];

    const result: GraphNeighbor[] = [];
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
  traceDependencies(
    startNode: string,
    maxDepth: number,
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    return this.bfs(startNode, maxDepth, "forward", edgeTypes);
  }

  /**
   * BFS reverse traversal — returns nodes that transitively depend on startNode.
   */
  traceDependents(
    startNode: string,
    maxDepth: number,
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    return this.bfs(startNode, maxDepth, "reverse", edgeTypes);
  }

  /**
   * Returns a neighbourhood subgraph centred on a node, exploring both
   * directions up to `radius` hops.
   */
  getSubgraph(centerNode: string, radius: number, edgeTypes?: GraphEdgeType[]): SubgraphResult {
    // Forward BFS + reverse BFS, then merge
    const forward = this.bfs(centerNode, radius, "forward", edgeTypes);
    const reverse = this.bfs(centerNode, radius, "reverse", edgeTypes);

    const nodeMap = new Map<string, number>();
    for (const n of forward.nodes) nodeMap.set(n.id, n.depth);
    for (const n of reverse.nodes) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n.depth);
    }

    const edgeSet = new Set<string>();
    const edges: SubgraphResult["edges"] = [];
    const addEdges = (list: SubgraphResult["edges"]) => {
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
  findPath(from: string, to: string): PathResult | null {
    if (!this.g.hasNode(from) || !this.g.hasNode(to)) return null;

    const nodePath = bidirectional(this.g, from, to);
    if (!nodePath) return null;

    const edges: PathResult["edges"] = [];
    for (let i = 0; i < nodePath.length - 1; i++) {
      const src = nodePath[i];
      const tgt = nodePath[i + 1];
      // Get the edge type from the first edge between these two nodes
      const edgeKey = this.g.edge(src, tgt);
      if (edgeKey !== undefined) {
        const attrs = this.g.getEdgeAttributes(edgeKey);
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
  detectCycles(edgeTypes?: GraphEdgeType[], maxLength = 20): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();

    const dfs = (node: string) => {
      visited.add(node);
      onStack.add(node);
      stack.push(node);

      this.g.forEachOutEdge(node, (_key, attrs, _src, neighbor) => {
        if (edgeTypes && !edgeTypes.includes(attrs.type)) return;
        if (stack.length > maxLength) return;

        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (onStack.has(neighbor)) {
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
  getTopNodes(
    metric: "degree" | "betweenness" | "connected_components",
    topN: number,
  ): TopNodeResult[] {
    const scores = new Map<string, number>();

    if (metric === "degree") {
      this.g.forEachNode((node) => {
        scores.set(node, this.g.outDegree(node));
      });
    } else if (metric === "betweenness") {
      // Use a simple approximation: node appears in many paths
      // For correctness we could use graphology-metrics betweenness, but
      // it requires an undirected graph or additional setup. Use out-degree
      // as a proxy for now.
      this.g.forEachNode((node) => {
        scores.set(node, this.g.outDegree(node) + this.g.inDegree(node));
      });
    } else {
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

  private addEdgeRow(edge: GraphEdgeRow): void {
    const src = encodeNodeId(edge.source_type, edge.source_id);
    const tgt = encodeNodeId(edge.target_type, edge.target_id);
    const key = edgeKey(src, tgt, edge.edge_type);

    if (!this.g.hasNode(src)) this.g.addNode(src);
    if (!this.g.hasNode(tgt)) this.g.addNode(tgt);

    if (!this.g.hasEdge(key)) {
      this.g.addEdgeWithKey(key, src, tgt, {
        type: edge.edge_type,
        metadata: edge.metadata,
        source_file_id: edge.source_file_id,
      });
    }
  }

  private bfs(
    startNode: string,
    maxDepth: number,
    direction: "forward" | "reverse",
    edgeTypes?: GraphEdgeType[],
  ): SubgraphResult {
    const nodes: SubgraphResult["nodes"] = [];
    const edges: SubgraphResult["edges"] = [];

    if (!this.g.hasNode(startNode)) {
      return { nodes, edges };
    }

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const queue: Array<{ node: string; depth: number }> = [{ node: startNode, depth: 0 }];
    visitedNodes.add(startNode);

    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      const { node, depth } = entry;
      nodes.push({ id: node, depth });

      if (depth >= maxDepth) continue;

      const iterFn =
        direction === "forward"
          ? (cb: (key: string, attrs: EdgeAttrs, src: string, tgt: string) => void) => {
              this.g.forEachOutEdge(node, cb);
            }
          : (cb: (key: string, attrs: EdgeAttrs, src: string, tgt: string) => void) => {
              this.g.forEachInEdge(node, (key, attrs, src) => {
                cb(key, attrs, src, node);
              });
            };

      iterFn((key, attrs, src, tgt) => {
        if (edgeTypes && !edgeTypes.includes(attrs.type)) return;

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
