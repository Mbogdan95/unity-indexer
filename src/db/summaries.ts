import type { ParsedComponent, ParsedScript, ParsedScriptMember } from "../types.js";

const MAX_SHOWN = 5;

// ---------------------------------------------------------------------------
// generateComponentSummary
// ---------------------------------------------------------------------------

/**
 * Maps each component to its display type name.
 * MonoBehaviour components with a known scriptGuid resolve to the class name.
 */
export function generateComponentSummary(
  components: ParsedComponent[],
  guidToClassName: Map<string, string>,
): string {
  return components
    .map((c) => {
      if (c.typeName === "MonoBehaviour" && c.scriptGuid !== null) {
        return guidToClassName.get(c.scriptGuid) ?? "MonoBehaviour";
      }
      return c.typeName;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// generateSubtreeSummary
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable summary of a GameObject and its direct children.
 * Leaf nodes return just the name; parents list up to MAX_SHOWN children.
 */
export function generateSubtreeSummary(name: string, childNames: string[]): string {
  if (childNames.length === 0) return name;

  const shown = childNames.slice(0, MAX_SHOWN);
  const rest = childNames.length - shown.length;

  let childList = shown.join(", ");
  if (rest > 0) childList += `, ...+${String(rest)} more`;

  return `${name} [${String(childNames.length)} children: ${childList}]`;
}

// ---------------------------------------------------------------------------
// generateFieldSummary
// ---------------------------------------------------------------------------

/**
 * Returns a compact key=value summary of serialized fields.
 * GUID references are resolved to a name or truncated guid prefix.
 */
export function generateFieldSummary(
  fields: Record<string, unknown>,
  guidNames?: Map<string, string>,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if ("guid" in obj && typeof obj.guid === "string") {
        const guid = obj.guid;
        const resolved = guidNames?.get(guid) ?? guid.slice(0, 8);
        parts.push(`${key}=ref:${resolved}`);
      } else {
        parts.push(`${key}={...}`);
      }
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }

  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// generateApiSummary
// ---------------------------------------------------------------------------

/**
 * Generates a multi-line API summary for a parsed C# script.
 * First line: "ClassName : BaseClass, Interface1, ..."
 * Subsequent lines group members by kind.
 */
export function generateApiSummary(script: ParsedScript): string {
  const lines: string[] = [];

  // Header line
  const bases: string[] = [];
  if (script.baseClass) bases.push(script.baseClass);
  bases.push(...script.interfaces);

  const header = bases.length > 0 ? `${script.className} : ${bases.join(", ")}` : script.className;
  lines.push(header);

  // Group members by kind
  const fields = script.members.filter(
    (m) => m.kind === "field" && (m.attributes.includes("SerializeField") || m.access === "public"),
  );
  const properties = script.members.filter((m) => m.kind === "property");
  // Prefer public methods, but show all if none are public
  const allMethods = script.members.filter((m) => m.kind === "method" || m.kind === "constructor");
  const publicMethods = allMethods.filter((m) => m.access === "public");
  const methods = publicMethods.length > 0 ? publicMethods : allMethods;
  const events = script.members.filter((m) => m.kind === "event");

  if (fields.length > 0) {
    const fieldParts = fields.map((f) => {
      const attrs =
        f.attributes.length > 0 ? f.attributes.map((a) => `[${a}]`).join(" ") + " " : "";
      return `${f.name}(${f.returnType})${attrs ? " " + attrs.trimEnd() : ""}`;
    });
    lines.push(`  fields: ${fieldParts.join(", ")}`);
  }

  if (properties.length > 0) {
    const propParts = properties.map((p) => `${p.name}(${p.returnType}) {get}`);
    lines.push(`  properties: ${propParts.join(", ")}`);
  }

  if (methods.length > 0) {
    const methodParts = methods.map((m) => {
      const paramTypes = m.parameters.map((p) => p.type).join(", ");
      return `${m.name}(${paramTypes})`;
    });
    lines.push(`  methods: ${methodParts.join(", ")}`);
  }

  if (events.length > 0) {
    const eventParts = events.map((e) => `${e.name}(${e.returnType})`);
    lines.push(`  events: ${eventParts.join(", ")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// generateMemberSignature
// ---------------------------------------------------------------------------

/**
 * Generates a full C#-style member signature string.
 */
export function generateMemberSignature(member: ParsedScriptMember): string {
  const attrPrefix =
    member.attributes.length > 0 ? member.attributes.map((a) => `[${a}]`).join(" ") + " " : "";
  const staticPart = member.isStatic ? "static " : "";

  let sig: string;

  switch (member.kind) {
    case "constructor": {
      const params = member.parameters.map((p) => `${p.type} ${p.name}`).join(", ");
      sig = `${attrPrefix}${member.access} ${staticPart}${member.name}(${params})`;
      break;
    }
    case "method": {
      const params = member.parameters.map((p) => `${p.type} ${p.name}`).join(", ");
      sig = `${attrPrefix}${member.access} ${staticPart}${member.returnType} ${member.name}(${params})`;
      break;
    }
    case "field": {
      sig = `${attrPrefix}${member.access} ${staticPart}${member.returnType} ${member.name}`;
      break;
    }
    case "property": {
      sig = `${attrPrefix}${member.access} ${staticPart}${member.returnType} ${member.name} { get; }`;
      break;
    }
    case "event": {
      sig = `${attrPrefix}${member.access} ${staticPart}event ${member.returnType} ${member.name}`;
      break;
    }
    default: {
      sig = `${member.access} ${member.name}`;
    }
  }

  return sig.trim();
}

// ---------------------------------------------------------------------------
// generateFileSummaryLine
// ---------------------------------------------------------------------------

/**
 * Returns a single-line summary for a file, formatted by type.
 */
export function generateFileSummaryLine(
  type: string,
  fileName: string,
  stats: Record<string, unknown>,
): string {
  switch (type) {
    case "scene": {
      const goCount = Number(stats.gameObjectCount ?? 0);
      const scriptCount = Number(stats.scriptCount ?? 0);
      return `${fileName} — ${String(goCount)} GameObjects, ${String(scriptCount)} scripts`;
    }
    case "prefab": {
      const variant = stats.isVariant === true ? "prefab variant" : "prefab";
      const goCount = Number(stats.gameObjectCount ?? 0);
      return `${fileName} — ${variant}, ${String(goCount)} GameObjects`;
    }
    case "script": {
      const rawClassName = stats.className;
      const className = typeof rawClassName === "string" ? rawClassName : "";
      const rawBaseClass = stats.baseClass;
      const baseClass = typeof rawBaseClass === "string" ? rawBaseClass : "";
      const memberCount = Number(stats.memberCount ?? 0);
      const classHeader = baseClass !== "" ? `${className} : ${baseClass}` : className;
      return `${fileName} — ${classHeader}, ${String(memberCount)} members`;
    }
    case "asset": {
      const rawTypeName = stats.typeName;
      const typeName = typeof rawTypeName === "string" ? rawTypeName : "";
      return `${fileName} — ${typeName}`;
    }
    case "asmdef": {
      const rawAsmName = stats.assemblyName;
      const assemblyName = typeof rawAsmName === "string" ? rawAsmName : "";
      return `${fileName} — assembly: ${assemblyName}`;
    }
    default:
      return fileName;
  }
}

// ---------------------------------------------------------------------------
// computeGameObjectImportance
// ---------------------------------------------------------------------------

/**
 * Computes an importance score [0, 1] for a GameObject.
 */
export function computeGameObjectImportance(stats: {
  hasMonoBehaviour: boolean;
  childCount: number;
  depth: number;
  refCount: number;
}): number {
  let score = 0;
  if (stats.hasMonoBehaviour) score += 0.4;
  score += Math.min(stats.childCount / 20, 0.3);
  score += Math.min(stats.refCount / 10, 0.2);
  if (stats.depth === 0) score += 0.1;
  return Math.min(Math.round(score * 1e10) / 1e10, 1.0);
}

// ---------------------------------------------------------------------------
// computeFileImportance
// ---------------------------------------------------------------------------

/**
 * Computes an importance score [0, 1] for a file.
 */
export function computeFileImportance(stats: {
  incomingRefCount: number;
  outgoingRefCount: number;
  hasCustomScripts: boolean;
  changeFrequency: number;
}): number {
  let score = 0;
  score += Math.min(stats.incomingRefCount / 20, 0.3);
  score += Math.min(stats.outgoingRefCount / 20, 0.2);
  if (stats.hasCustomScripts) score += 0.3;
  score += Math.min(stats.changeFrequency / 10, 0.2);
  return Math.min(Math.round(score * 1e10) / 1e10, 1.0);
}
