import { describe, it, expect } from "vitest";
import { parseAsset } from "../../src/parsers/asset-parser.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

describe("parseAsset", () => {
  it("extracts ScriptableObject name", () => {
    const content = readFileSync(join(FIXTURES, "ScriptableObjects/GameConfig.asset"), "utf-8");
    const result = parseAsset(content);
    expect(result.name).toBe("GameConfig");
  });

  it("extracts script GUID", () => {
    const content = readFileSync(join(FIXTURES, "ScriptableObjects/GameConfig.asset"), "utf-8");
    const result = parseAsset(content);
    expect(result.scriptGuid).toBe("c1c2c3c4c5c6c1c2c3c4c5c6");
  });

  it("extracts custom serialized fields", () => {
    const content = readFileSync(join(FIXTURES, "ScriptableObjects/GameConfig.asset"), "utf-8");
    const result = parseAsset(content);
    expect(result.serializedFields["maxPlayers"]).toBe(4);
    expect(result.serializedFields["startingHealth"]).toBe(100);
  });

  it("extracts nested data structures", () => {
    const content = readFileSync(join(FIXTURES, "ScriptableObjects/GameConfig.asset"), "utf-8");
    const result = parseAsset(content);
    const gameModes = result.serializedFields["gameModes"] as Array<Record<string, unknown>>;
    expect(gameModes).toHaveLength(2);
    expect(gameModes[0]["name"]).toBe("Deathmatch");
  });

  it("extracts GUID references", () => {
    const content = readFileSync(join(FIXTURES, "ScriptableObjects/GameConfig.asset"), "utf-8");
    const result = parseAsset(content);
    const scriptRef = result.references.find((r) => r.targetGuid === "c1c2c3c4c5c6c1c2c3c4c5c6");
    expect(scriptRef).toBeDefined();
  });
});
