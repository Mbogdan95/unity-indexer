import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { Indexer } from "../../src/indexer/indexer.js";
import { Store } from "../../src/db/store.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { encodeNodeId } from "../../src/types.js";
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
    expect(scenes.length).toBe(2);
    expect(scenes.some((s) => s.path.includes("MainScene.unity"))).toBe(true);
  });

  it("indexes scene GameObjects and components", () => {
    indexer.indexAll();
    const scenes = store.listFiles("scene");
    expect(scenes.length).toBe(2);
    const sceneFile = scenes.find((s) => s.path.includes("MainScene.unity"))!;
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
    expect(summary.scene_count).toBe(2);
    expect(summary.script_count).toBeGreaterThan(0);
  });

  it("incrementally updates a single file", () => {
    indexer.indexAll();
    indexer.indexFile("Assets/Scripts/PlayerController.cs");
    const scripts = store.listScripts();
    const playerControllers = scripts.filter((s) => s.class_name === "PlayerController");
    expect(playerControllers.length).toBe(1);
  });

  it("indexes script members with start_line and end_line", () => {
    indexer.indexAll();
    const pc = store.getScriptByClassName("PlayerController");
    expect(pc).toBeDefined();
    const members = store.getScriptMembers(pc!.id);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((m) => m.start_line > 0 && m.end_line > 0)).toBe(true);
    expect(members.every((m) => m.start_line <= m.end_line)).toBe(true);
  });

  it("stores project root path in project_summary", () => {
    indexer.indexAll();
    const rootPath = store.getProjectRootPath();
    expect(rootPath.length).toBeGreaterThan(0);
    expect(rootPath).toContain("TestProject");
  });

  it("indexes USES edges from field type declarations", () => {
    indexer.indexAll();

    // HealthSystem.cs has: private PlayerController controller;
    // so HealthSystem USES PlayerController should be in the graph
    const healthSystem = store.getScriptByClassName("HealthSystem");
    const playerController = store.getScriptByClassName("PlayerController");
    expect(healthSystem).toBeDefined();
    expect(playerController).toBeDefined();

    const hsNodeId = encodeNodeId("script", healthSystem!.id);
    const pcNodeId = encodeNodeId("script", playerController!.id);

    const outgoing = store.graph.getOutgoing(hsNodeId, ["USES"]);
    expect(outgoing.some((n) => n.nodeId === pcNodeId)).toBe(true);
  });
});
