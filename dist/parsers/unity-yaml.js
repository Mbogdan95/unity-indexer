import { parseDocument } from "yaml";
import { UNITY_CLASS_IDS } from "../types.js";
// Anchors are signed int64 since Unity 2018.3 (e.g. "&-8720842103846894243").
const DOC_HEADER_RE = /^--- !u!(\d+) &(-?\d+)(?: stripped)?\s*$/;
// Root keys that are serialized base-class names rather than concrete types
// (e.g. FlareLayer and Halo both serialize under "Behaviour").
const GENERIC_ROOT_KEYS = new Set(["Behaviour"]);
/** Stringify a fileID value (string, number, or bigint) without losing precision. */
export function canonicalFileId(raw) {
    if (typeof raw === "number" || typeof raw === "bigint")
        return String(raw);
    if (typeof raw === "string")
        return raw;
    return "";
}
/**
 * YAML is parsed with intAsBigInt so Unity's random int64 fileIDs keep full
 * precision (as float64 they collide: adjacent IDs like ...8001/...8002 round
 * to the same value). BigInts can't be JSON-serialized, so convert them back:
 * safe integers become numbers, the rest become exact decimal strings.
 */
function normalizeBigInts(value) {
    if (typeof value === "bigint") {
        const n = Number(value);
        return Number.isSafeInteger(n) ? n : String(value);
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++)
            value[i] = normalizeBigInts(value[i]);
        return value;
    }
    if (value !== null && typeof value === "object") {
        const record = value;
        for (const key of Object.keys(record))
            record[key] = normalizeBigInts(record[key]);
        return value;
    }
    return value;
}
export function parseUnityYaml(content) {
    const documents = [];
    const rawDocs = splitDocuments(content);
    for (const raw of rawDocs) {
        const headerMatch = DOC_HEADER_RE.exec(raw.header);
        if (!headerMatch)
            continue;
        const classId = parseInt(headerMatch[1], 10);
        const fileId = canonicalFileId(headerMatch[2]);
        const stripped = raw.header.includes("stripped");
        // The YAML root key is the class name Unity writes for the object and is
        // authoritative for concrete types (including package/custom built-ins the
        // map doesn't know). Fall back to the class-ID map for the few built-ins
        // that serialize under a base-class key and for docs with no body.
        const yamlRootKey = raw.body.match(/^(\w+):/)?.[1];
        const typeName = yamlRootKey !== undefined && !GENERIC_ROOT_KEYS.has(yamlRootKey)
            ? yamlRootKey
            : classId in UNITY_CLASS_IDS
                ? UNITY_CLASS_IDS[classId]
                : (yamlRootKey ?? `UnknownType_${String(classId)}`);
        let data;
        try {
            const doc = parseDocument(raw.body, { uniqueKeys: false, intAsBigInt: true });
            data =
                normalizeBigInts(doc.toJS({ maxAliasCount: -1 })) ?? {};
        }
        catch {
            data = parseYamlFallback(raw.body);
        }
        documents.push({ classId, fileId, stripped, typeName, data });
    }
    return documents;
}
function splitDocuments(content) {
    const docs = [];
    // Split on \r?\n so CRLF checkouts parse identically to LF ones.
    const lines = content.split(/\r?\n/);
    let currentHeader = "";
    let currentBody = [];
    for (const line of lines) {
        if (line.startsWith("--- !u!")) {
            if (currentHeader) {
                docs.push({ header: currentHeader, body: currentBody.join("\n") });
            }
            currentHeader = line;
            currentBody = [];
        }
        else if (line.startsWith("%") || line.startsWith("---")) {
            continue;
        }
        else if (currentHeader) {
            currentBody.push(line);
        }
    }
    if (currentHeader) {
        docs.push({ header: currentHeader, body: currentBody.join("\n") });
    }
    return docs;
}
function parseYamlFallback(body) {
    const result = {};
    const lines = body.split("\n");
    if (lines.length > 0) {
        const rootMatch = lines[0].match(/^(\w+):$/);
        if (rootMatch) {
            result[rootMatch[1]] = {};
        }
    }
    return result;
}
export function extractReferences(data, context) {
    const refs = [];
    walkForReferences(data, context, refs);
    return refs;
}
function walkForReferences(obj, context, refs) {
    if (obj === null || obj === undefined)
        return;
    if (typeof obj === "object" && !Array.isArray(obj)) {
        const record = obj;
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
    }
    else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            walkForReferences(obj[i], `${context}[${String(i)}]`, refs);
        }
    }
}
//# sourceMappingURL=unity-yaml.js.map