import { parseUnityYaml, extractReferences } from "./unity-yaml.js";
import { buildScene } from "./scene-parser.js";
import type { ParsedPrefab } from "../types.js";

export function parsePrefab(content: string): ParsedPrefab {
  const docs = parseUnityYaml(content);
  const scene = buildScene(docs);

  let isVariant = false;
  let sourcePrefabGuid: string | null = null;

  for (const doc of docs) {
    if (doc.classId === 1001) {
      const typeName = Object.keys(doc.data)[0];
      if (!typeName) continue;
      const data = doc.data[typeName] as Record<string, unknown>;
      const sourcePrefab = data["m_SourcePrefab"] as Record<string, unknown> | undefined;
      if (sourcePrefab !== undefined && typeof sourcePrefab["guid"] === "string") {
        isVariant = true;
        sourcePrefabGuid = sourcePrefab["guid"];
      }
    }
  }

  for (const doc of docs) {
    if (doc.classId === 1001) {
      const refs = extractReferences(doc.data, `PrefabInstance:${doc.fileId}`);
      for (const ref of refs) {
        ref.refType = "prefab_variant";
      }
      scene.references.push(...refs);
    }
  }

  return { ...scene, isVariant, sourcePrefabGuid };
}
