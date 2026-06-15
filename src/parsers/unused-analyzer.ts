import type { Node } from "web-tree-sitter";
import { getParser } from "./script-parser.js";
import { walkAll, collectClassBodies, type ClassBodyRange } from "./relationship-extractor.js";
import type { ScriptMemberRow } from "../types.js";

// ============================================================
// Exported Types
// ============================================================

export interface UnusedUsing {
  name: string;
  line: number;
}

export interface UnusedField {
  name: string;
  type: string;
  line: number;
}

export interface UnusedLocal {
  name: string;
  type: string;
  line: number;
  method_name: string;
}

export interface UnusedMethod {
  name: string;
  access: string;
  signature: string;
  line: number;
  called_by_classes?: string[];
}

export interface ClassUnusedResult {
  class_name: string;
  unused_fields: UnusedField[];
  unused_locals: UnusedLocal[];
  unused_methods: UnusedMethod[];
}

export interface FileUnusedResult {
  file_path: string; // prefixed path for output
  unused_usings: UnusedUsing[];
  classes: ClassUnusedResult[];
  error?: string;
}

// Input assembled by the handler — no DB access inside this file
export interface ClassInput {
  scriptId: number;
  className: string;
  isGenerated: boolean;
  members: (ScriptMemberRow & { id: number })[];
  externalCallerClassNames: string[]; // from graph CALLS incoming edges
}

export interface AnalyzeFileInput {
  content: string;
  filePath: string; // used verbatim in output
  classes: ClassInput[];
}

// ============================================================
// Constants
// ============================================================

const UNITY_LIFECYCLE_METHODS = new Set([
  "Awake",
  "Start",
  "Update",
  "FixedUpdate",
  "LateUpdate",
  "OnEnable",
  "OnDisable",
  "OnDestroy",
  "OnTriggerEnter",
  "OnTriggerExit",
  "OnTriggerStay",
  "OnTriggerEnter2D",
  "OnTriggerExit2D",
  "OnTriggerStay2D",
  "OnCollisionEnter",
  "OnCollisionExit",
  "OnCollisionStay",
  "OnCollisionEnter2D",
  "OnCollisionExit2D",
  "OnCollisionStay2D",
  "OnApplicationPause",
  "OnApplicationQuit",
  "OnBecameVisible",
  "OnBecameInvisible",
  "Reset",
  "OnValidate",
  "OnDrawGizmos",
  "OnDrawGizmosSelected",
  "OnMouseDown",
  "OnMouseUp",
  "OnMouseEnter",
  "OnMouseExit",
  "OnMouseOver",
  "OnGUI",
  "OnAnimatorIK",
  "OnAnimatorMove",
  "OnParticleCollision",
  "OnJointBreak",
  "OnRenderImage",
  "OnRenderObject",
  "OnPreCull",
  "OnPreRender",
  "OnPostRender",
]);

const EXEMPT_METHOD_ATTRIBUTES = new Set([
  "RuntimeInitializeOnLoadMethod",
  "MenuItem",
  "InitializeOnLoadMethod",
  "Preserve",
  "ContextMenu",
  "ContextMenuItem",
]);

// ============================================================
// Helper: find the actual AST body node matching a ClassBodyRange
// ============================================================

function findBodyNode(root: Node, range: ClassBodyRange): Node | null {
  let found: Node | null = null;
  walkAll(root, (n) => {
    if (found) return;
    if (n.startIndex === range.startIndex && n.endIndex === range.endIndex) {
      found = n;
    }
  });
  return found;
}

// ============================================================
// Helper: access modifier from list of modifier strings
// ============================================================

function getAccessFromModifiers(modifiers: string[]): string {
  if (modifiers.includes("public")) return "public";
  if (modifiers.includes("protected") && modifiers.includes("internal"))
    return "protected internal";
  if (modifiers.includes("private") && modifiers.includes("protected")) return "private protected";
  if (modifiers.includes("protected")) return "protected";
  if (modifiers.includes("internal")) return "internal";
  return "private";
}

// ============================================================
// analyzeUsings
// ============================================================

function analyzeUsings(root: Node, classBodies: ClassBodyRange[]): UnusedUsing[] {
  // Collect all identifiers across all class bodies
  const fileIdentifiers = new Set<string>();
  for (const range of classBodies) {
    const bodyNode = findBodyNode(root, range);
    if (!bodyNode) continue;
    walkAll(bodyNode, (n) => {
      if (n.type === "identifier") {
        fileIdentifiers.add(n.text);
      }
    });
  }

  const unused: UnusedUsing[] = [];

  for (const child of root.children) {
    if (child.type !== "using_directive") continue;

    const text = child.text;

    // Skip aliased usings (too complex)
    if (text.includes("=")) continue;

    // Extract namespace: strip "using " prefix and ";" suffix
    const namespaceName = text
      .replace(/^using\s+/, "")
      .replace(/;$/, "")
      .trim();

    // Last segment after last "."
    const dotIndex = namespaceName.lastIndexOf(".");
    const lastSegment = dotIndex >= 0 ? namespaceName.slice(dotIndex + 1) : namespaceName;

    const line = child.startPosition.row + 1;

    if (!fileIdentifiers.has(lastSegment)) {
      unused.push({ name: namespaceName, line });
    }
  }

  return unused;
}

// ============================================================
// countIdentifiersInRange
// ============================================================

function countIdentifiersInRange(classBodyRange: ClassBodyRange, root: Node): Map<string, number> {
  const counts = new Map<string, number>();
  const bodyNode = findBodyNode(root, classBodyRange);
  if (!bodyNode) return counts;

  walkAll(bodyNode, (n) => {
    if (n.type === "identifier") {
      counts.set(n.text, (counts.get(n.text) ?? 0) + 1);
    }
  });

  return counts;
}

// ============================================================
// analyzeFields
// ============================================================

function analyzeFields(
  members: (ScriptMemberRow & { id: number })[],
  identifierCounts: Map<string, number>,
): UnusedField[] {
  const unused: UnusedField[] = [];

  for (const member of members) {
    if (member.kind !== "field") continue;
    if (member.access === "public") continue;
    if (member.has_serialize_field) continue;

    // Check attributes JSON for SerializeField or Header
    let attrs: string[] = [];
    try {
      const parsed: unknown = JSON.parse(member.attributes);
      if (Array.isArray(parsed)) {
        attrs = (parsed as unknown[]).filter((x): x is string => typeof x === "string");
      }
    } catch {
      // ignore JSON parse errors
    }

    if (attrs.includes("SerializeField") || attrs.includes("Header")) continue;

    const count = identifierCounts.get(member.name) ?? 0;
    // UNUSED if count <= 1 (declaration itself counts as one occurrence)
    if (count <= 1) {
      unused.push({
        name: member.name,
        type: member.return_type,
        line: member.start_line,
      });
    }
  }

  return unused;
}

// ============================================================
// analyzeLocals
// ============================================================

function analyzeLocals(classBodyRange: ClassBodyRange, root: Node): UnusedLocal[] {
  const unused: UnusedLocal[] = [];
  const bodyNode = findBodyNode(root, classBodyRange);
  if (!bodyNode) return unused;

  // Walk class body for method_declaration nodes
  walkAll(bodyNode, (method) => {
    if (method.type !== "method_declaration") return;

    const methodNameNode = method.childForFieldName("name");
    const methodName = methodNameNode?.text ?? "";

    const methodBody = method.childForFieldName("body");
    if (!methodBody) return;

    // Count identifiers within this method body
    const localIdentifierCounts = new Map<string, number>();
    walkAll(methodBody, (n) => {
      if (n.type === "identifier") {
        localIdentifierCounts.set(n.text, (localIdentifierCounts.get(n.text) ?? 0) + 1);
      }
    });

    // Walk method body for local_declaration_statement nodes
    walkAll(methodBody, (node) => {
      if (node.type !== "local_declaration_statement") return;

      const varDecl = node.namedChildren.find((c) => c.type === "variable_declaration");
      if (!varDecl) return;

      const typeNode = varDecl.childForFieldName("type");
      const typeText = typeNode?.text ?? "";

      const declarators = varDecl.namedChildren.filter((c) => c.type === "variable_declarator");
      for (const declarator of declarators) {
        const nameNode = declarator.childForFieldName("name");
        const name = nameNode?.text ?? "";

        if (name === "" || name.startsWith("_")) continue;

        const count = localIdentifierCounts.get(name) ?? 0;
        // UNUSED if count <= 1 (declaration itself)
        if (count <= 1) {
          unused.push({
            name,
            type: typeText,
            line: node.startPosition.row + 1,
            method_name: methodName,
          });
        }
      }
    });
  });

  return unused;
}

// ============================================================
// analyzeMethods
// ============================================================

function analyzeMethods(
  classBodyRange: ClassBodyRange,
  root: Node,
  identifierCounts: Map<string, number>,
  classInput: ClassInput,
): UnusedMethod[] {
  const unused: UnusedMethod[] = [];
  const bodyNode = findBodyNode(root, classBodyRange);
  if (!bodyNode) return unused;

  walkAll(bodyNode, (method) => {
    if (method.type !== "method_declaration") return;

    const nameNode = method.childForFieldName("name");
    const name = nameNode?.text ?? "";
    if (name === "") return;

    // Collect modifiers
    const modifiers = method.children
      .filter((c) => c.type === "modifier")
      .flatMap((m) => m.children.map((mc) => mc.text));

    const access = getAccessFromModifiers(modifiers);

    // Skip public methods
    if (access === "public") return;

    // Skip Unity lifecycle methods
    if (UNITY_LIFECYCLE_METHODS.has(name)) return;

    // Parse attributes and check for exempt attributes
    const methodAttrs: string[] = [];
    for (const child of method.children) {
      if (child.type === "attribute_list") {
        for (const attrNode of child.namedChildren) {
          if (attrNode.type === "attribute") {
            const attrName = attrNode.childForFieldName("name")?.text;
            if (attrName != null && attrName !== "") methodAttrs.push(attrName);
          }
        }
      }
    }

    if (methodAttrs.some((a) => EXEMPT_METHOD_ATTRIBUTES.has(a))) return;

    const count = identifierCounts.get(name) ?? 0;
    // Candidate if count <= 1
    if (count <= 1) {
      const signature = method.text
        .split("\n")[0]
        .trim()
        .replace(/\s*\{?\s*$/, "");
      const line = method.startPosition.row + 1;

      if (classInput.externalCallerClassNames.length > 0) {
        unused.push({
          name,
          access,
          signature,
          line,
          called_by_classes: classInput.externalCallerClassNames,
        });
      } else {
        unused.push({ name, access, signature, line });
      }
    }
  });

  return unused;
}

// ============================================================
// Main exported function
// ============================================================

export function analyzeFile(input: AnalyzeFileInput): FileUnusedResult {
  const parser = getParser();
  if (!parser) {
    throw new Error("Script parser not initialized");
  }

  const tree = parser.parse(input.content);
  if (!tree) {
    return {
      file_path: input.filePath,
      unused_usings: [],
      classes: [],
    };
  }

  const root = tree.rootNode;
  const classBodies = collectClassBodies(root);
  const unusedUsings = analyzeUsings(root, classBodies);

  const results: ClassUnusedResult[] = [];

  for (const classInput of input.classes) {
    if (classInput.isGenerated) continue;

    // Find matching ClassBodyRange by className
    const classBodyRange = classBodies.find((r) => r.className === classInput.className);
    if (!classBodyRange) continue;

    const identifierCounts = countIdentifiersInRange(classBodyRange, root);
    const unusedFields = analyzeFields(classInput.members, identifierCounts);
    const unusedLocals = analyzeLocals(classBodyRange, root);
    const unusedMethods = analyzeMethods(classBodyRange, root, identifierCounts, classInput);

    if (unusedFields.length > 0 || unusedLocals.length > 0 || unusedMethods.length > 0) {
      results.push({
        class_name: classInput.className,
        unused_fields: unusedFields,
        unused_locals: unusedLocals,
        unused_methods: unusedMethods,
      });
    }
  }

  tree.delete();

  return {
    file_path: input.filePath,
    unused_usings: unusedUsings,
    classes: results,
  };
}
