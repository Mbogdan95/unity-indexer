import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import {
  handleGetSceneHierarchy,
  handleListScripts,
  handleGetScriptDetail,
  handleFindReferences,
  handleSearch,
  handleRecentChanges,
  handleGetGameObject,
  handleGetComponent,
  handleResolveGuid,
  handleFindComponents,
  type StoreResolver,
} from "../../src/mcp/tools.js";
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

describe("handleGetSceneHierarchy", () => {
  it("returns roots with name/components/token_hint for MainScene.unity", () => {
    const result = handleGetSceneHierarchy(store, {
      scene: "Assets/Scenes/MainScene.unity",
    }) as Record<string, unknown>;

    expect(result.token_hint).toBeDefined();
    expect(typeof result.token_hint).toBe("number");
    expect(result.roots).toBeDefined();
    const roots = result.roots as Array<Record<string, unknown>>;
    expect(roots.length).toBeGreaterThan(0);
    const first = roots[0];
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("components");
  });

  it("filters by name", () => {
    const result = handleGetSceneHierarchy(store, {
      scene: "Assets/Scenes/MainScene.unity",
      filter: "Player",
    }) as Record<string, unknown>;

    const roots = result.roots as Array<Record<string, unknown>>;
    expect(
      roots.every(
        (r) =>
          String(r.name).toLowerCase().includes("player") ||
          String(r.tag).toLowerCase().includes("player"),
      ),
    ).toBe(true);
  });

  it("returns error for missing scene", () => {
    const result = handleGetSceneHierarchy(store, {
      scene: "Assets/Scenes/Missing.unity",
    }) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });
});

describe("handleListScripts", () => {
  it("returns scripts with class_name/api_summary", () => {
    const result = handleListScripts(store, {}) as Record<string, unknown>;

    expect(result.scripts).toBeDefined();
    const scripts = result.scripts as Array<Record<string, unknown>>;
    expect(scripts.length).toBeGreaterThan(0);
    const first = scripts[0];
    expect(first).toHaveProperty("class_name");
    expect(first).toHaveProperty("api_summary");
  });

  it("filters by is_monobehaviour", () => {
    const result = handleListScripts(store, { is_monobehaviour: true }) as Record<string, unknown>;
    const scripts = result.scripts as Array<Record<string, unknown>>;
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((s) => s.is_monobehaviour === true)).toBe(true);
  });

  it("filters to zero when no monobehaviours match false + no non-MB scripts exist... is ok", () => {
    const allResult = handleListScripts(store, {}) as Record<string, unknown>;
    const allScripts = allResult.scripts as Array<Record<string, unknown>>;
    const nonMbResult = handleListScripts(store, { is_monobehaviour: false }) as Record<
      string,
      unknown
    >;
    const nonMbScripts = nonMbResult.scripts as Array<Record<string, unknown>>;
    // total = monobehaviour + non-monobehaviour
    const mbResult = handleListScripts(store, { is_monobehaviour: true }) as Record<
      string,
      unknown
    >;
    const mbScripts = mbResult.scripts as Array<Record<string, unknown>>;
    expect(mbScripts.length + nonMbScripts.length).toBe(allScripts.length);
  });
});

describe("handleGetScriptDetail", () => {
  it("returns class_name=PlayerController with members having signature", () => {
    const result = handleGetScriptDetail(store, { class_name: "PlayerController" }) as Record<
      string,
      unknown
    >;

    expect(result.class_name).toBe("PlayerController");
    expect(result.members).toBeDefined();
    const members = result.members as Array<Record<string, unknown>>;
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]).toHaveProperty("signature");
  });

  it("returns error for unknown class", () => {
    const result = handleGetScriptDetail(store, { class_name: "NonExistent" }) as Record<
      string,
      unknown
    >;
    expect(result.error).toBeDefined();
  });
});

describe("handleFindReferences", () => {
  it("finds references to guid a1b2c3d4e5f6a1b2c3d4e5f6", () => {
    const result = handleFindReferences(store, {
      guid_or_name: "a1b2c3d4e5f6a1b2c3d4e5f6",
    }) as Record<string, unknown>;

    expect(result.references).toBeDefined();
    const refs = result.references as unknown[];
    expect(refs.length).toBeGreaterThan(0);
  });

  it("resolves class name to guid and finds references", () => {
    const result = handleFindReferences(store, {
      guid_or_name: "PlayerController",
    }) as Record<string, unknown>;

    expect(result.references).toBeDefined();
    const refs = result.references as unknown[];
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe("handleSearch", () => {
  it("finds results for query Player", () => {
    const result = handleSearch(store, { query: "Player" }) as Record<string, unknown>;

    expect(result.results).toBeDefined();
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
  });

  it("scoped search for scripts", () => {
    const result = handleSearch(store, { query: "Player", scope: "scripts" }) as Record<
      string,
      unknown
    >;
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.every((r) => r.type === "script")).toBe(true);
  });
});

describe("handleRecentChanges", () => {
  it("returns changes with length > 0", () => {
    const result = handleRecentChanges(store, {}) as Record<string, unknown>;

    expect(result.changes).toBeDefined();
    const changes = result.changes as unknown[];
    expect(changes.length).toBeGreaterThan(0);
  });

  it("respects limit", () => {
    const result = handleRecentChanges(store, { limit: 1 }) as Record<string, unknown>;
    const changes = result.changes as unknown[];
    expect(changes.length).toBeLessThanOrEqual(1);
  });
});

describe("handleGetGameObject", () => {
  it("returns Player GameObject details", () => {
    const result = handleGetGameObject(store, {
      scene: "Assets/Scenes/MainScene.unity",
      name_or_id: "Player",
    }) as Record<string, unknown>;

    expect(result.name).toBe("Player");
    expect(result.components).toBeDefined();
    const components = result.components as unknown[];
    expect(components.length).toBeGreaterThan(0);
  });

  it("returns error for missing game object", () => {
    const result = handleGetGameObject(store, {
      scene: "Assets/Scenes/MainScene.unity",
      name_or_id: "DoesNotExist",
    }) as Record<string, unknown>;
    expect(result.error).toBeDefined();
  });
});

describe("handleResolveGuid", () => {
  it("resolves a1b2c3d4e5f6a1b2c3d4e5f6 to path + asset_type script", () => {
    const result = handleResolveGuid(store, {
      guid: "a1b2c3d4e5f6a1b2c3d4e5f6",
    }) as Record<string, unknown>;

    expect(result.path).toBeDefined();
    expect(result.asset_type).toBe("script");
  });

  it("returns error for unknown GUID", () => {
    const result = handleResolveGuid(store, { guid: "deadbeef00000000" }) as Record<
      string,
      unknown
    >;
    expect(result.error).toBeDefined();
  });
});

describe("handleFindComponents", () => {
  it("finds components by type", () => {
    const result = handleFindComponents(store, { type: "Transform" }) as Record<string, unknown>;

    expect(result.components).toBeDefined();
    const components = result.components as unknown[];
    expect(components.length).toBeGreaterThan(0);
  });

  it("finds components scoped to a scene", () => {
    const result = handleFindComponents(store, {
      type: "Transform",
      scene: "Assets/Scenes/MainScene.unity",
    }) as Record<string, unknown>;

    expect(result.components).toBeDefined();
    const components = result.components as unknown[];
    expect(components.length).toBeGreaterThan(0);
  });
});

describe("variant prefab resolution", () => {
  it("handleGetSceneHierarchy resolves variant to base prefab GameObjects", () => {
    const result = handleGetSceneHierarchy(store, {
      scene: "Assets/Prefabs/EnemyVariant.prefab",
    }) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.is_variant).toBe(true);
    expect(result.resolved_from).toBe("Assets/Prefabs/Enemy.prefab");
    const roots = result.roots as Array<Record<string, unknown>>;
    expect(roots.length).toBeGreaterThan(0);
    expect(roots[0].name).toBe("Enemy");
  });

  it("handleGetGameObject resolves variant to base prefab", () => {
    const result = handleGetGameObject(store, {
      scene: "Assets/Prefabs/EnemyVariant.prefab",
      name_or_id: "Enemy",
    }) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.is_variant).toBe(true);
    expect(result.name).toBe("Enemy");
    expect(result.components).toBeDefined();
    const components = result.components as unknown[];
    expect(components.length).toBeGreaterThan(0);
  });

  it("handleGetComponent resolves variant to base prefab", () => {
    const result = handleGetComponent(store, {
      scene: "Assets/Prefabs/EnemyVariant.prefab",
      game_object: "Enemy",
      component_type: "Transform",
    }) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.is_variant).toBe(true);
    expect(result.type_name).toBe("Transform");
  });

  it("non-variant prefab does not set resolved_from", () => {
    const result = handleGetSceneHierarchy(store, {
      scene: "Assets/Prefabs/Enemy.prefab",
    }) as Record<string, unknown>;

    expect(result.is_variant).toBeUndefined();
    expect(result.resolved_from).toBeUndefined();
    const roots = result.roots as Array<Record<string, unknown>>;
    expect(roots.length).toBeGreaterThan(0);
  });
});

describe("StoreResolver", () => {
  it("auto-resolves when single project", () => {
    const resolver: StoreResolver = (name?: string) => {
      if (name !== undefined && name !== "") throw new Error("unexpected name");
      return store;
    };
    expect(resolver()).toBe(store);
  });

  it("resolves by project name", () => {
    const resolver: StoreResolver = (name?: string) => {
      if (name === "TestProject") return store;
      throw new Error(`Unknown project "${String(name)}"`);
    };
    expect(resolver("TestProject")).toBe(store);
  });

  it("throws for unknown project name", () => {
    const resolver: StoreResolver = (name?: string) => {
      if (name === "TestProject") return store;
      throw new Error(`Unknown project "${String(name)}"`);
    };
    expect(() => resolver("Nonexistent")).toThrow('Unknown project "Nonexistent"');
  });
});
