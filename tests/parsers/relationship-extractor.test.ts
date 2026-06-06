import { describe, it, expect, beforeAll } from "vitest";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { extractRelationships } from "../../src/parsers/relationship-extractor.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets");

beforeAll(async () => {
  await initScriptParser();
});

describe("extractRelationships", () => {
  it("extracts GetComponent<T> calls", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const getCompRels = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "PlayerController",
    );
    expect(getCompRels.length).toBeGreaterThan(0);
  });

  it("extracts static method calls", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const staticCalls = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "PlayerController",
    );
    expect(staticCalls.length).toBeGreaterThan(0);
  });

  it("extracts constructor calls (new T())", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const newCalls = rels.filter(
      (r) => r.edgeType === "CALLS" && r.targetClassName === "EnemySpawner",
    );
    expect(newCalls.length).toBeGreaterThan(0);
  });

  it("extracts event subscriptions (+=)", () => {
    const content = `using System;
    public class Listener : MonoBehaviour {
        void Start() {
            SomeManager.OnEvent += HandleEvent;
        }
        void HandleEvent() {}
    }`;
    const rels = extractRelationships(content);
    const subs = rels.filter((r) => r.edgeType === "SUBSCRIBES_TO");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs[0].targetClassName).toBe("SomeManager");
  });

  it("ignores Unity built-in types", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const builtins = rels.filter(
      (r) => r.targetClassName === "MeshRenderer" || r.targetClassName === "Debug",
    );
    expect(builtins).toHaveLength(0);
  });

  it("returns empty array for interface-only file", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/IDamageable.cs"), "utf-8");
    const rels = extractRelationships(content);
    expect(rels).toHaveLength(0);
  });

  it("associates relationships with source class name", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const rels = extractRelationships(content);
    const healthRels = rels.filter((r) => r.sourceClassName === "HealthSystem");
    expect(healthRels.length).toBeGreaterThan(0);
  });
});
