import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import {
  handleTraceDependencies,
  handleTraceDependents,
  handleFindPath,
  handleGetSubgraph,
  handleDetectCycles,
  handleGetGraphStats,
} from "../../src/mcp/graph-tools.js";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject");
let store: Store;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(":memory:");
  const indexer = new Indexer(store, FIXTURES);
  indexer.indexAll();
});

afterEach(() => {
  store.close();
});

describe("handleTraceDependencies", () => {
  it("returns subgraph for known script", () => {
    const result = handleTraceDependencies(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
    expect(result.summary).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("returns error for unknown identifier", () => {
    const result = handleTraceDependencies(store, {
      identifier: "NonExistent",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });
});

describe("handleTraceDependents", () => {
  it("returns dependents for a script", () => {
    const result = handleTraceDependents(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("handleFindPath", () => {
  it("returns null-like response when no path", () => {
    const result = handleFindPath(store, {
      from: "PlayerController",
      to: "NonExistent",
    }) as Record<string, unknown>;

    // Should have error or empty path
    expect(result.error || result.path === null).toBeTruthy();
  });
});

describe("handleGetSubgraph", () => {
  it("returns neighborhood for a script", () => {
    const result = handleGetSubgraph(store, {
      identifier: "PlayerController",
      radius: 1,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as unknown[];
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("handleDetectCycles", () => {
  it("returns cycles array (possibly empty)", () => {
    const result = handleDetectCycles(store, {}) as Record<string, unknown>;

    expect(result.cycles).toBeDefined();
    expect(Array.isArray(result.cycles)).toBe(true);
  });
});

describe("handleGetGraphStats", () => {
  it("returns degree stats", () => {
    const result = handleGetGraphStats(store, {
      metric: "degree",
      top_n: 5,
    }) as Record<string, unknown>;

    expect(result.rankings).toBeDefined();
    const rankings = result.rankings as unknown[];
    expect(rankings.length).toBeGreaterThan(0);
  });
});
