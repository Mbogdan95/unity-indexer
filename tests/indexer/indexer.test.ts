import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { Indexer } from "../../src/indexer/indexer.js";
import { Store } from "../../src/db/store.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject");
let store: Store;
let indexer: Indexer;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(":memory:");
  indexer = new Indexer(store, FIXTURES);
});

afterEach(() => {
  store.close();
});

describe("Indexer", () => {
  it("indexes a full project", () => {
    indexer.indexAll();
    const files = store.listFiles();
    expect(files.length).toBeGreaterThan(0);
    const scenes = store.listFiles("scene");
    expect(scenes.length).toBe(1);
    expect(scenes[0].path).toContain("MainScene.unity");
  });

  it("indexes scene GameObjects and components", () => {
    indexer.indexAll();
    const scenes = store.listFiles("scene");
    expect(scenes.length).toBe(1);
    const sceneFile = scenes[0];
    const gameObjects = store.getGameObjectsByFile(sceneFile.id);
    const player = gameObjects.find((go) => go.name === "Player");
    expect(player).toBeDefined();
    expect(player!.component_summary).toContain("Transform");
  });

  it("indexes scripts with members", () => {
    indexer.indexAll();
    const script = store.getScriptByClassName("PlayerController");
    expect(script).toBeDefined();
    expect(script!.is_monobehaviour).toBeTruthy();
    const members = store.getScriptMembers(script!.id);
    const takeDamage = members.find((m) => m.name === "TakeDamage");
    expect(takeDamage).toBeDefined();
  });

  it("indexes GUIDs from meta files", () => {
    indexer.indexAll();
    const guidRow = store.resolveGuid("a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(guidRow).toBeDefined();
    expect(guidRow!.asset_type).toBe("script");
  });

  it("indexes references", () => {
    indexer.indexAll();
    const refs = store.getReferencesToGuid("a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(refs.length).toBeGreaterThan(0);
  });

  it("indexes asmdef files", () => {
    indexer.indexAll();
    const asmdefs = store.listFiles("asmdef");
    expect(asmdefs.length).toBe(1);
  });

  it("generates project summary", () => {
    indexer.indexAll();
    const summary = store.getProjectSummary();
    expect(summary.scene_count).toBe(1);
    expect(summary.script_count).toBeGreaterThan(0);
  });

  it("incrementally updates a single file", () => {
    indexer.indexAll();
    indexer.indexFile("Assets/Scripts/PlayerController.cs");
    const scripts = store.listScripts();
    const playerControllers = scripts.filter((s) => s.class_name === "PlayerController");
    expect(playerControllers.length).toBe(1);
  });
});
