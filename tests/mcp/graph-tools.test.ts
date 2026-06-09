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
  handleFindImplementors,
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
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    // NEW: every node must have a label field
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
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
  it("returns dependents for a script with label fields", () => {
    const result = handleTraceDependents(store, {
      identifier: "PlayerController",
      depth: 2,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
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

  it("returns path nodes as {id, type, label} objects when path exists", () => {
    // HealthSystem USES PlayerController — guaranteed connected after indexAll
    const result = handleFindPath(store, {
      from: "HealthSystem",
      to: "PlayerController",
    }) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.path).toBeDefined();
    const path = result.path as Array<Record<string, unknown>>;
    expect(path.length).toBeGreaterThan(0);
    expect(typeof path[0].id).toBe("string");
    expect(typeof path[0].type).toBe("string");
    expect(typeof path[0].label).toBe("string");
  });
});

describe("handleGetSubgraph", () => {
  it("returns neighborhood with label fields", () => {
    const result = handleGetSubgraph(store, {
      identifier: "PlayerController",
      radius: 1,
    }) as Record<string, unknown>;

    expect(result.nodes).toBeDefined();
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.label === "string")).toBe(true);
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

describe("handleFindImplementors", () => {
  it("returns implementors for IDamageable", () => {
    // PlayerController.cs declares: public class PlayerController : MonoBehaviour, IDamageable
    const result = handleFindImplementors(store, {
      interface_name: "IDamageable",
    }) as Record<string, unknown>;

    expect(result.interface_name).toBe("IDamageable");
    expect(result.implementors).toBeDefined();
    const implementors = result.implementors as Array<Record<string, unknown>>;
    expect(implementors.length).toBeGreaterThan(0);
    const pc = implementors.find((i) => i.class_name === "PlayerController");
    expect(pc).toBeDefined();
    expect(typeof pc!.file_path).toBe("string");
    expect((pc!.file_path as string).endsWith(".cs")).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("returns error for unknown interface", () => {
    const result = handleFindImplementors(store, {
      interface_name: "INonExistent",
    }) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });

  it("returns empty implementors for class with no implementors", () => {
    // HealthSystem is a class, not an interface — no one IMPLEMENTs it
    const result = handleFindImplementors(store, {
      interface_name: "HealthSystem",
    }) as Record<string, unknown>;

    // Not an error (HealthSystem is a valid script) — just 0 implementors
    expect(result.error).toBeUndefined();
    const implementors = result.implementors as Array<Record<string, unknown>>;
    expect(implementors).toHaveLength(0);
  });
});
