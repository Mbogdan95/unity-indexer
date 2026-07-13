import { describe, it, expect } from "vitest";
import { parseScene } from "../../src/parsers/scene-parser.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

describe("parseScene", () => {
  it("extracts GameObjects from scene file", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    expect(result.gameObjects).toHaveLength(2);
    const names = result.gameObjects.map((go) => go.name);
    expect(names).toContain("Player");
    expect(names).toContain("Sprite");
  });

  it("builds parent-child hierarchy", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const player = result.gameObjects.find((go) => go.name === "Player")!;
    expect(player.parentFileIdLocal).toBeNull();
    const sprite = result.gameObjects.find((go) => go.name === "Sprite")!;
    expect(sprite.parentFileIdLocal).toBe(player.fileIdLocal);
  });

  it("extracts components per GameObject", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const player = result.gameObjects.find((go) => go.name === "Player")!;
    const componentTypes = player.components.map((c) => c.typeName);
    expect(componentTypes).toContain("Transform");
    expect(componentTypes).toContain("MonoBehaviour");
  });

  it("extracts MonoBehaviour script GUID", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const player = result.gameObjects.find((go) => go.name === "Player")!;
    const mb = player.components.find((c) => c.typeName === "MonoBehaviour")!;
    expect(mb.scriptGuid).toBe("a1b2c3d4e5f6a1b2c3d4e5f6");
  });

  it("strips default values from component fields", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const player = result.gameObjects.find((go) => go.name === "Player")!;
    const mb = player.components.find((c) => c.typeName === "MonoBehaviour")!;
    expect(mb.serializedFields).not.toHaveProperty("m_Enabled");
    expect(mb.serializedFields).not.toHaveProperty("m_ObjectHideFlags");
    expect(mb.serializedFields).toHaveProperty("speed");
    expect(mb.serializedFields["speed"]).toBe(5.5);
  });

  it("extracts GUID references from scene", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const scriptRef = result.references.find((r) => r.targetGuid === "a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(scriptRef).toBeDefined();
    expect(scriptRef!.refType).toBe("script_attachment");
    const weaponRef = result.references.find((r) => r.targetGuid === "e1e2e3e4e5e6e1e2e3e4e5e6");
    expect(weaponRef).toBeDefined();
  });

  it("extracts GameObject metadata (layer, tag, active)", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const result = parseScene(content);
    const player = result.gameObjects.find((go) => go.name === "Player")!;
    expect(player.tag).toBe("Player");
    expect(player.layer).toBe(0);
    expect(player.active).toBe(true);
  });
});

describe("uGUI and modern-format scenes", () => {
  it("builds hierarchy through RectTransform (classId 224)", () => {
    const content = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Canvas
  m_IsActive: 1
  m_Component:
  - component: {fileID: 101}
--- !u!224 &101
RectTransform:
  m_GameObject: {fileID: 100}
  m_Father: {fileID: 0}
--- !u!1 &200
GameObject:
  m_Name: Button
  m_IsActive: 1
  m_Component:
  - component: {fileID: 201}
--- !u!224 &201
RectTransform:
  m_GameObject: {fileID: 200}
  m_Father: {fileID: 101}
`;
    const scene = parseScene(content);
    expect(scene.gameObjects).toHaveLength(2);
    const canvas = scene.gameObjects.find((g) => g.name === "Canvas")!;
    const button = scene.gameObjects.find((g) => g.name === "Button")!;
    expect(canvas.parentFileIdLocal).toBeNull();
    expect(button.parentFileIdLocal).toBe("100");
    expect(canvas.components[0].typeName).toBe("RectTransform");
  });

  it("links components with unsafe-integer fileIDs (random int64)", () => {
    const content = `%YAML 1.1
--- !u!1 &-9110748745971813952
GameObject:
  m_Name: BigId
  m_IsActive: 1
  m_Component:
  - component: {fileID: 8345145045156654994}
--- !u!4 &8345145045156654994
Transform:
  m_GameObject: {fileID: -9110748745971813952}
  m_Father: {fileID: 0}
`;
    const scene = parseScene(content);
    expect(scene.gameObjects).toHaveLength(1);
    expect(scene.gameObjects[0].name).toBe("BigId");
    expect(scene.gameObjects[0].components).toHaveLength(1);
    expect(scene.gameObjects[0].components[0].typeName).toBe("Transform");
  });
});
