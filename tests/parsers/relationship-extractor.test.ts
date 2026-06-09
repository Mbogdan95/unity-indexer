import { describe, it, expect, beforeAll } from "vitest";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import {
  extractRelationships,
  extractTypeReferences,
} from "../../src/parsers/relationship-extractor.js";
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

describe("extractTypeReferences", () => {
  it("extracts field type references as USES edges", () => {
    // HealthSystem.cs has: private PlayerController controller;
    const content = readFileSync(join(FIXTURES, "Scripts/HealthSystem.cs"), "utf-8");
    const refs = extractTypeReferences(content);
    const fieldRefs = refs.filter(
      (r) =>
        r.edgeType === "USES" &&
        r.sourceClassName === "HealthSystem" &&
        r.targetClassName === "PlayerController",
    );
    expect(fieldRefs.length).toBeGreaterThan(0);
  });

  it("extracts method parameter types as USES edges", () => {
    const content = `
public class MyClass {
  public void Init(PlayerController ctrl) {}
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some(
        (r) =>
          r.edgeType === "USES" &&
          r.sourceClassName === "MyClass" &&
          r.targetClassName === "PlayerController",
      ),
    ).toBe(true);
  });

  it("extracts local variable type declarations as USES edges", () => {
    const content = `
public class MyClass {
  void Foo() {
    PlayerController ctrl = null;
  }
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some(
        (r) =>
          r.edgeType === "USES" &&
          r.sourceClassName === "MyClass" &&
          r.targetClassName === "PlayerController",
      ),
    ).toBe(true);
  });

  it("ignores C# primitive types", () => {
    const content = `
public class MyClass {
  private int count;
  private string name;
  private bool flag;
  void Foo(float x) {}
}`;
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });

  it("ignores Unity built-in types", () => {
    const content = `
public class MyClass {
  private Rigidbody rb;
  private Animator anim;
  private Camera cam;
}`;
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });

  it("strips generic wrapper and extracts inner type", () => {
    const content = `
public class MyClass {
  private List<PlayerController> players;
}`;
    const refs = extractTypeReferences(content);
    expect(
      refs.some((r) => r.edgeType === "USES" && r.targetClassName === "PlayerController"),
    ).toBe(true);
  });

  it("deduplicates identical source/target pairs", () => {
    const content = `
public class MyClass {
  private PlayerController ctrl1;
  private PlayerController ctrl2;
}`;
    const refs = extractTypeReferences(content);
    const dupes = refs.filter(
      (r) => r.sourceClassName === "MyClass" && r.targetClassName === "PlayerController",
    );
    expect(dupes).toHaveLength(1);
  });

  it("skips var (implicit type) declarations", () => {
    const content = `
public class MyClass {
  void Foo() {
    var x = new PlayerController();
  }
}`;
    const refs = extractTypeReferences(content);
    // var is unresolvable — should not emit USES for 'var'
    expect(refs.every((r) => r.targetClassName !== "var")).toBe(true);
  });

  it("returns empty array for interface-only file", () => {
    const content = readFileSync(join(FIXTURES, "Scripts/IDamageable.cs"), "utf-8");
    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(0);
  });
});
