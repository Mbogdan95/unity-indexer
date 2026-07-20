import { describe, it, expect } from "vitest";
import { parseUnityYaml, extractReferences } from "../../src/parsers/unity-yaml.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

describe("parseUnityYaml", () => {
  it("splits multi-document Unity YAML into documents", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    expect(docs.length).toBeGreaterThan(0);
    const gameObjectDocs = docs.filter((d) => d.classId === 1);
    expect(gameObjectDocs).toHaveLength(2);
  });

  it("extracts classId and fileId from document headers", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    const playerGo = docs.find((d) => d.classId === 1 && d.fileId === "100000");
    expect(playerGo).toBeDefined();
    expect(playerGo!.typeName).toBe("GameObject");
    const transform = docs.find((d) => d.classId === 4 && d.fileId === "100002");
    expect(transform).toBeDefined();
    expect(transform!.typeName).toBe("Transform");
  });

  it("parses document body as key-value data", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    const playerGo = docs.find((d) => d.classId === 1 && d.fileId === "100000");
    expect(playerGo).toBeDefined();
    const goData = playerGo!.data["GameObject"] as Record<string, unknown>;
    expect(goData["m_Name"]).toBe("Player");
    expect(goData["m_TagString"]).toBe("Player");
    expect(goData["m_IsActive"]).toBe(1);
  });

  it("parses inline references as objects", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    const monoBehaviour = docs.find((d) => d.classId === 114 && d.fileId === "100004");
    expect(monoBehaviour).toBeDefined();
    const mbData = monoBehaviour!.data["MonoBehaviour"] as Record<string, unknown>;
    const scriptRef = mbData["m_Script"] as Record<string, unknown>;
    expect(scriptRef["guid"]).toBe("a1b2c3d4e5f6a1b2c3d4e5f6");
  });

  it("resolves typeName from class ID map", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    expect(docs.find((d) => d.classId === 114)!.typeName).toBe("MonoBehaviour");
    expect(docs.find((d) => d.classId === 29)!.typeName).toBe("OcclusionCullingSettings");
  });
});

describe("extractReferences", () => {
  it("extracts GUID references from parsed document data", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    const monoBehaviour = docs.find((d) => d.classId === 114 && d.fileId === "100004");
    const refs = extractReferences(monoBehaviour!.data, "MonoBehaviour:100004");
    const scriptRef = refs.find((r) => r.targetGuid === "a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(scriptRef).toBeDefined();
    const weaponRef = refs.find((r) => r.targetGuid === "e1e2e3e4e5e6e1e2e3e4e5e6");
    expect(weaponRef).toBeDefined();
  });

  it("ignores references with no guid (local fileID-only refs)", () => {
    const content = readFileSync(join(FIXTURES, "Scenes/MainScene.unity"), "utf-8");
    const docs = parseUnityYaml(content);
    const transform = docs.find((d) => d.classId === 4 && d.fileId === "100002");
    const refs = extractReferences(transform!.data, "Transform:100002");
    expect(refs).toHaveLength(0);
  });
});

describe("modern Unity serialization formats", () => {
  it("parses negative int64 fileID anchors (Unity 2018.3+)", () => {
    const content = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &-8720842103846894243
GameObject:
  m_Name: NegAnchor
  m_IsActive: 1
`;
    const docs = parseUnityYaml(content);
    expect(docs).toHaveLength(1);
    expect(docs[0].fileId).toBe("-8720842103846894243");
    expect(docs[0].typeName).toBe("GameObject");
  });

  it("parses CRLF line endings identically to LF", () => {
    const lf = `%YAML 1.1
--- !u!1 &100000
GameObject:
  m_Name: Player
--- !u!4 &100002
Transform:
  m_GameObject: {fileID: 100000}
`;
    const crlf = lf.replace(/\n/g, "\r\n");
    const docsLf = parseUnityYaml(lf);
    const docsCrlf = parseUnityYaml(crlf);
    expect(docsCrlf).toHaveLength(docsLf.length);
    expect(docsCrlf.map((d) => d.fileId)).toEqual(docsLf.map((d) => d.fileId));
    const go = docsCrlf.find((d) => d.classId === 1);
    expect((go!.data["GameObject"] as Record<string, unknown>)["m_Name"]).toBe("Player");
  });

  it("parses stripped documents", () => {
    const content = `%YAML 1.1
--- !u!4 &123 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 400000, guid: abc123, type: 3}
`;
    const docs = parseUnityYaml(content);
    expect(docs).toHaveLength(1);
    expect(docs[0].stripped).toBe(true);
  });

  it("prefers the YAML root key over the class-ID map", () => {
    const content = `%YAML 1.1
--- !u!224 &900
RectTransform:
  m_GameObject: {fileID: 100}
`;
    const docs = parseUnityYaml(content);
    expect(docs[0].typeName).toBe("RectTransform");
  });

  it("falls back to the class-ID map for base-class root keys", () => {
    const content = `%YAML 1.1
--- !u!124 &901
Behaviour:
  m_Enabled: 1
`;
    const docs = parseUnityYaml(content);
    expect(docs[0].typeName).toBe("FlareLayer");
  });

  it("resolves correct names for uGUI and renderer class IDs", () => {
    const cases: Array<[number, string]> = [
      [222, "CanvasRenderer"],
      [223, "Canvas"],
      [224, "RectTransform"],
      [225, "CanvasGroup"],
      [212, "SpriteRenderer"],
      [81, "AudioListener"],
      [82, "AudioSource"],
    ];
    for (const [classId, expected] of cases) {
      const content = `%YAML 1.1
--- !u!${String(classId)} &1000
${expected}:
  m_Enabled: 1
`;
      const docs = parseUnityYaml(content);
      expect(docs[0].typeName).toBe(expected);
    }
  });
});
