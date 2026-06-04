import { parseDocument } from "yaml";
import { UNITY_CLASS_IDS } from "../types.js";
import type { UnityYamlDocument, ParsedGuidReference } from "../types.js";

const DOC_HEADER_RE = /^--- !u!(\d+) &(\d+)(?: stripped)?$/;

export function parseUnityYaml(content: string): UnityYamlDocument[] {
  const documents: UnityYamlDocument[] = [];
  const rawDocs = splitDocuments(content);

  for (const raw of rawDocs) {
    const headerMatch = DOC_HEADER_RE.exec(raw.header);
    if (!headerMatch) continue;

    const classId = parseInt(headerMatch[1], 10);
    const fileId = headerMatch[2];
    const stripped = raw.header.includes("stripped");
    const typeName = UNITY_CLASS_IDS[classId] ?? `UnknownType_${classId}`;

    let data: Record<string, unknown> = {};
    try {
      const doc = parseDocument(raw.body, { uniqueKeys: false });
      data = doc.toJS({ maxAliasCount: -1 }) ?? {};
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
  const lines = content.split("\n");
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
      walkForReferences(obj[i], `${context}[${i}]`, refs);
    }
  }
}
