import { describe, it, expect } from "vitest";
import { parsePrefab } from "../../src/parsers/prefab-parser.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

describe("parsePrefab", () => {
  it("parses prefab GameObjects", () => {
    const content = readFileSync(join(FIXTURES, "Prefabs/Enemy.prefab"), "utf-8");
    const result = parsePrefab(content);
    expect(result.gameObjects).toHaveLength(1);
    expect(result.gameObjects[0].name).toBe("Enemy");
  });

  it("detects non-variant prefabs", () => {
    const content = readFileSync(join(FIXTURES, "Prefabs/Enemy.prefab"), "utf-8");
    const result = parsePrefab(content);
    expect(result.isVariant).toBe(false);
    expect(result.sourcePrefabGuid).toBeNull();
  });

  it("extracts components from prefab", () => {
    const content = readFileSync(join(FIXTURES, "Prefabs/Enemy.prefab"), "utf-8");
    const result = parsePrefab(content);
    const types = result.gameObjects[0].components.map((c) => c.typeName);
    expect(types).toContain("Transform");
    expect(types).toContain("MonoBehaviour");
  });

  it("extracts custom fields from MonoBehaviour", () => {
    const content = readFileSync(join(FIXTURES, "Prefabs/Enemy.prefab"), "utf-8");
    const result = parsePrefab(content);
    const mb = result.gameObjects[0].components.find((c) => c.typeName === "MonoBehaviour")!;
    expect(mb.serializedFields["patrolSpeed"]).toBe(3.0);
    expect(mb.serializedFields["chaseSpeed"]).toBe(6.0);
    expect(mb.serializedFields["detectionRange"]).toBe(10.0);
  });

  it("detects variant prefabs", () => {
    const variantContent = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &100100
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: e1e2e3e4e5e6e1e2e3e4e5e6, type: 3}`;
    const result = parsePrefab(variantContent);
    expect(result.isVariant).toBe(true);
    expect(result.sourcePrefabGuid).toBe("e1e2e3e4e5e6e1e2e3e4e5e6");
  });
});
