import { parseDocument } from "yaml";
import { UNITY_CLASS_IDS } from "../types.js";
import type { UnityYamlDocument, ParsedGuidReference } from "../types.js";

// Anchors are signed int64 since Unity 2018.3 (e.g. "&-8720842103846894243").
const DOC_HEADER_RE = /^--- !u!(\d+) &(-?\d+)(?: stripped)?\s*$/;

// Root keys that are serialized base-class names rather than concrete types
// (e.g. FlareLayer and Halo both serialize under "Behaviour").
const GENERIC_ROOT_KEYS = new Set(["Behaviour"]);

/**
 * Canonicalize a fileID so header-derived IDs compare equal to IDs parsed out
 * of YAML values. The YAML parser returns numbers, which lose precision beyond
 * 2^53 — Unity's random int64 fileIDs exceed that — so both sides must round
 * the same way.
 */
export function canonicalFileId(raw: unknown): string {
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n) && !Number.isSafeInteger(n)) return String(n);
    return raw;
  }
  return "";
}

export function parseUnityYaml(content: string): UnityYamlDocument[] {
  const documents: UnityYamlDocument[] = [];
  const rawDocs = splitDocuments(content);

  for (const raw of rawDocs) {
    const headerMatch = DOC_HEADER_RE.exec(raw.header);
    if (!headerMatch) continue;

    const classId = parseInt(headerMatch[1], 10);
    const fileId = canonicalFileId(headerMatch[2]);
    const stripped = raw.header.includes("stripped");
    // The YAML root key is the class name Unity writes for the object and is
    // authoritative for concrete types (including package/custom built-ins the
    // map doesn't know). Fall back to the class-ID map for the few built-ins
    // that serialize under a base-class key and for docs with no body.
    const yamlRootKey = raw.body.match(/^(\w+):/)?.[1];
    const typeName =
      yamlRootKey !== undefined && !GENERIC_ROOT_KEYS.has(yamlRootKey)
        ? yamlRootKey
        : classId in UNITY_CLASS_IDS
          ? UNITY_CLASS_IDS[classId]
          : (yamlRootKey ?? `UnknownType_${String(classId)}`);

    let data: Record<string, unknown>;
    try {
      const doc = parseDocument(raw.body, { uniqueKeys: false });
      data = (doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown> | null) ?? {};
    } catch {
      data = parseYamlFallback(raw.body);
    }

    documents.push({ classId, fileId, stripped, typeName, data });
  }

  return documents;
}

interface RawDocument {
  header: string;
  body: string;
}

function splitDocuments(content: string): RawDocument[] {
  const docs: RawDocument[] = [];
  // Split on \r?\n so CRLF checkouts parse identically to LF ones.
  const lines = content.split(/\r?\n/);
  let currentHeader = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith("--- !u!")) {
      if (currentHeader) {
        docs.push({ header: currentHeader, body: currentBody.join("\n") });
      }
      currentHeader = line;
      currentBody = [];
    } else if (line.startsWith("%") || line.startsWith("---")) {
      continue;
    } else if (currentHeader) {
      currentBody.push(line);
    }
  }

  if (currentHeader) {
    docs.push({ header: currentHeader, body: currentBody.join("\n") });
  }

  return docs;
}

function parseYamlFallback(body: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = body.split("\n");
  if (lines.length > 0) {
    const rootMatch = lines[0].match(/^(\w+):$/);
    if (rootMatch) {
      result[rootMatch[1]] = {};
    }
  }
  return result;
}

export function extractReferences(
  data: Record<string, unknown>,
  context: string,
): ParsedGuidReference[] {
  const refs: ParsedGuidReference[] = [];
  walkForReferences(data, context, refs);
  return refs;
}

function walkForReferences(obj: unknown, context: string, refs: ParsedGuidReference[]): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if ("guid" in record && "fileID" in record) {
      const guid = String(record["guid"]);
      const fileID = String(record["fileID"]);
      if (guid && guid !== "0" && guid !== "") {
        refs.push({
          targetGuid: guid,
          targetFileId: fileID,
          context,
          refType: context.includes("m_Script") ? "script_attachment" : "field_reference",
        });
      }
      return;
    }

    for (const [key, value] of Object.entries(record)) {
      walkForReferences(value, `${context}.${key}`, refs);
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkForReferences(obj[i], `${context}[${String(i)}]`, refs);
    }
  }
}
