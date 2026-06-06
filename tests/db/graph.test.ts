import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../../src/db/store.js";
import { GraphManager } from "../../src/db/graph.js";
import type { GraphEdgeRow } from "../../src/types.js";

let store: Store;
let graph: GraphManager;

function insertEdge(store: Store, edge: Omit<GraphEdgeRow, "id">): void {
  store.insertGraphEdge(edge);
}

beforeEach(() => {
  store = new Store(":memory:");
  graph = new GraphManager();
});

afterEach(() => {
  store.close();
});

describe("GraphManager", () => {
  it("hydrates from store edges", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    expect(graph.nodeCount()).toBe(2);
    expect(graph.edgeCount()).toBe(1);
  });

  it("gets outgoing neighbors", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const deps = graph.getOutgoing("script:1");
    expect(deps).toHaveLength(2);
  });

  it("gets incoming neighbors", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const dependents = graph.getIncoming("script:2");
    expect(dependents).toHaveLength(1);
    expect(dependents[0].nodeId).toBe("script:1");
  });

  it("traces transitive dependencies (BFS)", () => {
    // A -> B -> C
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependencies("script:1", 3);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it("respects depth limit", () => {
    // A -> B -> C
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependencies("script:1", 1);
    expect(result.nodes).toHaveLength(2); // A and B only
    expect(result.edges).toHaveLength(1);
  });

  it("traces dependents (reverse)", () => {
    // A -> B, C -> B
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const result = graph.traceDependents("script:2", 1);
    expect(result.nodes).toHaveLength(3); // B, A, C
  });

  it("finds shortest path", () => {
    // A -> B -> C -> D
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 4,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const path = graph.findPath("script:1", "script:4");
    expect(path).not.toBeNull();
    expect(path!.nodes).toHaveLength(4);
    expect(path!.nodes[0]).toBe("script:1");
    expect(path!.nodes[3]).toBe("script:4");
  });

  it("returns null when no path exists", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const path = graph.findPath("script:1", "script:3");
    expect(path).toBeNull();
  });

  it("gets subgraph within radius", () => {
    // A -> B -> C, A -> D
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 4,
      edge_type: "INHERITS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const sub = graph.getSubgraph("script:1", 1);
    expect(sub.nodes).toHaveLength(3); // A, B, D
    expect(sub.edges).toHaveLength(2);
  });

  it("patches graph on file change", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    graph.hydrate(store.getAllGraphEdges());

    expect(graph.edgeCount()).toBe(1);

    const newEdges: GraphEdgeRow[] = [
      {
        source_type: "script",
        source_id: 1,
        target_type: "script",
        target_id: 3,
        edge_type: "CALLS",
        metadata: null,
        source_file_id: 10,
      },
    ];
    graph.patchForFile(10, [], newEdges);

    expect(graph.edgeCount()).toBe(1);
    const out = graph.getOutgoing("script:1");
    expect(out).toHaveLength(1);
    expect(out[0].nodeId).toBe("script:3");
  });

  it("detects cycles", () => {
    // A -> B -> C -> A (cycle)
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 2,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 3,
      target_type: "script",
      target_id: 1,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const cycles = graph.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].length).toBe(3);
  });

  it("computes degree stats", () => {
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 2,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 3,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });
    insertEdge(store, {
      source_type: "script",
      source_id: 1,
      target_type: "script",
      target_id: 4,
      edge_type: "CALLS",
      metadata: null,
      source_file_id: 10,
    });

    graph.hydrate(store.getAllGraphEdges());

    const stats = graph.getTopNodes("degree", 2);
    expect(stats[0].nodeId).toBe("script:1");
    expect(stats[0].score).toBe(3); // 3 outgoing
  });
});
