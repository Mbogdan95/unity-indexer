import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { analyzeFile } from "../../src/parsers/unused-analyzer.js";
import type { ClassInput } from "../../src/parsers/unused-analyzer.js";
import type { ScriptMemberRow } from "../../src/types.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/TestProject/Assets/Scripts");

beforeAll(async () => {
  await initScriptParser();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClass(overrides: Partial<ClassInput> & { className: string }): ClassInput {
  return {
    scriptId: 1,
    isGenerated: false,
    members: [],
    externalCallerClassNames: [],
    ...overrides,
  };
}

type MemberOverrides = Partial<ScriptMemberRow & { id: number }> & { name: string };

function makeMember(overrides: MemberOverrides): ScriptMemberRow & { id: number } {
  return {
    id: 1,
    script_id: 1,
    kind: "field",
    access: "private",
    return_type: "int",
    parameters: "[]",
    attributes: "[]",
    signature: `private int ${overrides.name}`,
    has_serialize_field: false,
    has_header_attr: false,
    start_line: 5,
    end_line: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describe("analyzeUsings")
// ---------------------------------------------------------------------------

describe("analyzeUsings", () => {
  it("detects unused using directive", () => {
    const content = `
using System.Collections;
public class Foo {
  void Bar() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    expect(result.unused_usings.map((u) => u.name)).toContain("System.Collections");
  });

  it("does not flag used using directive", () => {
    // List<T> causes Generic namespace to be considered used
    const content = `
using System.Collections.Generic;
public class Foo {
  private List<int> _items = new List<int>();
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    expect(result.unused_usings.map((u) => u.name)).not.toContain("System.Collections.Generic");
  });

  it("exempts aliased using (using T = ...)", () => {
    const content = `
using MyAlias = System.Collections.Generic.List<int>;
public class Foo {
  void Bar() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    // Aliased usings should not appear in unused_usings
    expect(result.unused_usings).toHaveLength(0);
  });

  it("strips 'using static' correctly", () => {
    // "using static UnityEngine.Mathf" — last segment is "Mathf", which is unknown
    const content = `
using static UnityEngine.Mathf;
public class Foo {
  void Bar() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    // It should be detected as unused (Mathf segment not found as identifier)
    const names = result.unused_usings.map((u) => u.name);
    expect(names).toContain("UnityEngine.Mathf");
  });
});

// ---------------------------------------------------------------------------
// describe("analyzeFields")
// ---------------------------------------------------------------------------

describe("analyzeFields", () => {
  it("detects private field never referenced", () => {
    const content = `
public class Foo {
  private int _speed;
  void Bar() {}
}`;
    const members = [makeMember({ name: "_speed", return_type: "int" })];
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo", members })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_fields.map((f) => f.name)).toContain("_speed");
  });

  it("does not flag field with has_serialize_field = true", () => {
    const content = `
public class Foo {
  [SerializeField] private float _speed;
  void Bar() {}
}`;
    const members = [
      makeMember({ name: "_speed", return_type: "float", has_serialize_field: true }),
    ];
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo", members })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_fields.map((f) => f.name) ?? []).not.toContain("_speed");
  });

  it("does not flag public field", () => {
    const content = `
public class Foo {
  public int Speed;
  void Bar() {}
}`;
    const members = [makeMember({ name: "Speed", access: "public" })];
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo", members })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_fields.map((f) => f.name) ?? []).not.toContain("Speed");
  });

  it("does not flag field referenced in method body", () => {
    const content = `
public class Foo {
  private int _speed;
  void Bar() { _speed = 10; }
}`;
    const members = [makeMember({ name: "_speed", return_type: "int" })];
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo", members })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_fields.map((f) => f.name) ?? []).not.toContain("_speed");
  });
});

// ---------------------------------------------------------------------------
// describe("analyzeLocals")
// ---------------------------------------------------------------------------

describe("analyzeLocals", () => {
  it("detects local variable declared but never used", () => {
    const content = `
public class Foo {
  void Bar() {
    int unusedLocal = 10;
  }
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_locals.map((l) => l.name)).toContain("unusedLocal");
  });

  it("exempts _ prefixed local variables", () => {
    const content = `
public class Foo {
  void Bar() {
    string _exempted = "hello";
  }
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_locals.map((l) => l.name) ?? []).not.toContain("_exempted");
  });

  it("does not flag locals that are used", () => {
    const content = `
public class Foo {
  void Bar() {
    int usedLocal = 5;
    int result = usedLocal * 2;
  }
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_locals.map((l) => l.name) ?? []).not.toContain("usedLocal");
  });

  it("records method_name correctly", () => {
    const content = `
public class Foo {
  void MyMethod() {
    int unusedLocal = 10;
  }
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    const local = fooClass?.unused_locals.find((l) => l.name === "unusedLocal");
    expect(local?.method_name).toBe("MyMethod");
  });
});

// ---------------------------------------------------------------------------
// describe("analyzeMethods")
// ---------------------------------------------------------------------------

describe("analyzeMethods", () => {
  it("detects private method never called within file", () => {
    const content = `
public class Foo {
  private void TrulyUnused() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_methods.map((m) => m.name)).toContain("TrulyUnused");
  });

  it("does not flag Unity lifecycle methods (Awake, Start, Update)", () => {
    const content = `
public class Foo : MonoBehaviour {
  private void Awake() {}
  private void Start() {}
  private void Update() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    const methodNames = fooClass?.unused_methods.map((m) => m.name) ?? [];
    expect(methodNames).not.toContain("Awake");
    expect(methodNames).not.toContain("Start");
    expect(methodNames).not.toContain("Update");
  });

  it("does not flag public methods", () => {
    const content = `
public class Foo {
  public void PublicMethod() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_methods.map((m) => m.name) ?? []).not.toContain("PublicMethod");
  });

  it("does not flag methods with [MenuItem] attribute", () => {
    const content = `
public class Foo {
  [MenuItem("Tools/DoStuff")]
  private static void DoStuff() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_methods.map((m) => m.name) ?? []).not.toContain("DoStuff");
  });

  it("does not flag methods called within the file", () => {
    const content = `
public class Foo {
  private void Helper() {}
  private void Caller() { Helper(); }
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_methods.map((m) => m.name) ?? []).not.toContain("Helper");
  });

  it("does not flag override methods", () => {
    const content = `
public class Foo : Base {
  protected override void OnInit() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo" })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    expect(fooClass?.unused_methods.map((m) => m.name) ?? []).not.toContain("OnInit");
  });

  it("sets may_be_called_externally when external callers exist", () => {
    const content = `
public class Foo {
  private void InternalMethod() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Foo.cs",
      classes: [makeClass({ className: "Foo", externalCallerClassNames: ["SomeExternalClass"] })],
    });
    const fooClass = result.classes.find((c) => c.class_name === "Foo");
    const method = fooClass?.unused_methods.find((m) => m.name === "InternalMethod");
    expect(method?.may_be_called_externally).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe("multi-class file")
// ---------------------------------------------------------------------------

describe("multi-class file", () => {
  it("reports results per class independently", () => {
    const content = `
public class ClassA {
  private void UnusedInA() {}
}
public class ClassB {
  private void UnusedInB() {}
}`;
    const result = analyzeFile({
      content,
      filePath: "test/Multi.cs",
      classes: [
        makeClass({ className: "ClassA", scriptId: 1 }),
        {
          scriptId: 2,
          className: "ClassB",
          isGenerated: false,
          members: [],
          externalCallerClassNames: [],
        },
      ],
    });
    const classAResult = result.classes.find((c) => c.class_name === "ClassA");
    const classBResult = result.classes.find((c) => c.class_name === "ClassB");
    expect(classAResult?.unused_methods.map((m) => m.name)).toContain("UnusedInA");
    expect(classBResult?.unused_methods.map((m) => m.name)).toContain("UnusedInB");
  });

  it("does not bleed unused findings between classes", () => {
    // ClassA has _sharedName field, ClassB has a method called _sharedName
    // The field in ClassA should still be flagged since the method in ClassB
    // lives in a different class body scope
    const content = `
public class ClassA {
  private int _onlyInA;
}
public class ClassB {
  private int _onlyInB;
  private void UseOnlyInB() { _onlyInB = 1; }
}`;
    const membersA = [makeMember({ name: "_onlyInA", script_id: 1 })];
    const membersB = [makeMember({ id: 2, name: "_onlyInB", script_id: 2 })];
    const result = analyzeFile({
      content,
      filePath: "test/Multi.cs",
      classes: [
        {
          scriptId: 1,
          className: "ClassA",
          isGenerated: false,
          members: membersA,
          externalCallerClassNames: [],
        },
        {
          scriptId: 2,
          className: "ClassB",
          isGenerated: false,
          members: membersB,
          externalCallerClassNames: [],
        },
      ],
    });
    const classAResult = result.classes.find((c) => c.class_name === "ClassA");
    const classBResult = result.classes.find((c) => c.class_name === "ClassB");
    // _onlyInA should be unused (not referenced in ClassA's body)
    expect(classAResult?.unused_fields.map((f) => f.name)).toContain("_onlyInA");
    // _onlyInB should NOT be flagged (referenced inside UseOnlyInB)
    expect(classBResult?.unused_fields.map((f) => f.name) ?? []).not.toContain("_onlyInB");
  });
});

// ---------------------------------------------------------------------------
// describe("integration: UnusedSymbols.cs fixture")
// ---------------------------------------------------------------------------

describe("integration: UnusedSymbols.cs fixture", () => {
  const fixtureContent = readFileSync(join(FIXTURES, "UnusedSymbols.cs"), "utf-8");

  // Members for UnusedSymbols class (matching what a real DB scan would return)
  const unusedSymbolsMembers: (ScriptMemberRow & { id: number })[] = [
    makeMember({
      id: 1,
      script_id: 1,
      name: "_serialized",
      return_type: "float",
      has_serialize_field: true,
      attributes: '["SerializeField"]',
      start_line: 10,
    }),
    makeMember({
      id: 2,
      script_id: 1,
      name: "_usedField",
      return_type: "int",
      start_line: 11,
    }),
    makeMember({
      id: 3,
      script_id: 1,
      name: "_unusedField",
      return_type: "string",
      start_line: 12,
    }),
    makeMember({
      id: 4,
      script_id: 1,
      name: "_usedList",
      return_type: "List<int>",
      start_line: 13,
    }),
  ];

  const anotherClassMembers: (ScriptMemberRow & { id: number })[] = [
    makeMember({
      id: 5,
      script_id: 2,
      name: "_neverUsed",
      return_type: "int",
      start_line: 47,
    }),
  ];

  const buildResult = () =>
    analyzeFile({
      content: fixtureContent,
      filePath: "tests/fixtures/TestProject/Assets/Scripts/UnusedSymbols.cs",
      classes: [
        {
          scriptId: 1,
          className: "UnusedSymbols",
          isGenerated: false,
          members: unusedSymbolsMembers,
          externalCallerClassNames: [],
        },
        {
          scriptId: 2,
          className: "AnotherClass",
          isGenerated: false,
          members: anotherClassMembers,
          externalCallerClassNames: [],
        },
      ],
    });

  it("detects System.Collections as unused using", () => {
    const result = buildResult();
    expect(result.unused_usings.map((u) => u.name)).toContain("System.Collections");
  });

  it("does not flag System.Collections.Generic", () => {
    const result = buildResult();
    expect(result.unused_usings.map((u) => u.name)).not.toContain("System.Collections.Generic");
  });

  it("detects _unusedField in UnusedSymbols", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_fields.map((f) => f.name)).toContain("_unusedField");
  });

  it("does not flag _serialized (SerializeField)", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_fields.map((f) => f.name) ?? []).not.toContain("_serialized");
  });

  it("detects unusedLocal in MethodWithLocals", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_locals.map((l) => l.name)).toContain("unusedLocal");
  });

  it("detects TrulyUnusedMethod", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_methods.map((m) => m.name)).toContain("TrulyUnusedMethod");
  });

  it("does not flag Awake lifecycle method", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_methods.map((m) => m.name) ?? []).not.toContain("Awake");
  });

  it("does not flag PublicMethod (public)", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "UnusedSymbols");
    expect(cls?.unused_methods.map((m) => m.name) ?? []).not.toContain("PublicMethod");
  });

  it("detects _neverUsed in AnotherClass", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "AnotherClass");
    expect(cls?.unused_fields.map((f) => f.name)).toContain("_neverUsed");
  });

  it("does not flag Start in AnotherClass", () => {
    const result = buildResult();
    const cls = result.classes.find((c) => c.class_name === "AnotherClass");
    expect(cls?.unused_methods.map((m) => m.name) ?? []).not.toContain("Start");
  });
});
