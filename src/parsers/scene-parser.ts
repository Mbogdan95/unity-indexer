import { parseUnityYaml, extractReferences } from "./unity-yaml.js";
import { stripDefaults } from "./defaults.js";
import { UNITY_CLASS_IDS } from "../types.js";
import type {
  UnityYamlDocument,
  ParsedScene,
  ParsedGameObject,
  ParsedComponent,
  ParsedGuidReference,
} from "../types.js";

export function parseScene(content: string): ParsedScene {
  const docs = parseUnityYaml(content);
  return buildScene(docs);
}

export function buildScene(docs: UnityYamlDocument[]): ParsedScene {
  // Index all docs by fileId for fast lookup
  const docByFileId = new Map<string, UnityYamlDocument>();
  for (const doc of docs) {
    docByFileId.set(doc.fileId, doc);
  }

  // Collect all GameObject docs (classId === 1)
  const goDocs = docs.filter((d) => d.classId === 1);

  // Build Transform → GameObject mapping
  // Transform docs (classId === 4) have m_GameObject back-ref
  const transformToGo = new Map<string, string>(); // transformFileId → goFileId
  const goToTransform = new Map<string, string>(); // goFileId → transformFileId
  for (const doc of docs) {
    if (doc.classId === 4) {
      const data =
        (doc.data[doc.typeName] as Record<string, unknown> | undefined) ??
        (doc.data["Transform"] as Record<string, unknown> | undefined);
      if (!data) continue;
      const goRef = data["m_GameObject"] as Record<string, unknown> | undefined;
      if (goRef) {
        const goFileId = String(goRef["fileID"] ?? "");
        if (goFileId && goFileId !== "0") {
          transformToGo.set(doc.fileId, goFileId);
          goToTransform.set(goFileId, doc.fileId);
        }
      }
    }
  }

  // Build hierarchy: for each GO, find parent GO via Transform.m_Father
  const parentMap = new Map<string, string | null>(); // goFileId → parentGoFileId | null
  for (const doc of docs) {
    if (doc.classId === 4) {
      const data = getDocData(doc);
      if (!data) continue;
      const fatherRef = data["m_Father"] as Record<string, unknown> | undefined;
      const ownerGoFileId = transformToGo.get(doc.fileId);
      if (!ownerGoFileId) continue;

      if (fatherRef) {
        const fatherFileId = String(fatherRef["fileID"] ?? "0");
        if (fatherFileId && fatherFileId !== "0") {
          // fatherFileId is parent Transform's fileId → map to parent GO
          const parentGoFileId = transformToGo.get(fatherFileId) ?? null;
          parentMap.set(ownerGoFileId, parentGoFileId);
        } else {
          parentMap.set(ownerGoFileId, null);
        }
      } else {
        parentMap.set(ownerGoFileId, null);
      }
    }
  }

  // Collect all references from the entire document set
  const allReferences: ParsedGuidReference[] = [];
  for (const doc of docs) {
    const refs = extractReferences(doc.data, `${doc.typeName}:${doc.fileId}`);
    allReferences.push(...refs);
  }

  // Build GameObjects
  const gameObjects: ParsedGameObject[] = [];

  for (const goDoc of goDocs) {
    const data = getDocData(goDoc);
    if (!data) continue;

    const name = String(data["m_Name"] ?? "");
    const layer = Number(data["m_Layer"] ?? 0);
    const tag = String(data["m_TagString"] ?? "Untagged");
    const active = Number(data["m_IsActive"] ?? 1) !== 0;

    const parentGoFileId = parentMap.get(goDoc.fileId) ?? null;

    // Extract component fileIds from m_Component list
    const componentRefs = (data["m_Component"] as Array<Record<string, unknown>> | undefined) ?? [];
    const components: ParsedComponent[] = [];

    for (let order = 0; order < componentRefs.length; order++) {
      const compRef = componentRefs[order];
      const componentEntry = compRef["component"] as Record<string, unknown> | undefined;
      if (!componentEntry) continue;
      const compFileId = String(componentEntry["fileID"] ?? "");
      if (!compFileId || compFileId === "0") continue;

      const compDoc = docByFileId.get(compFileId);
      if (!compDoc) continue;

      const compData = getDocData(compDoc);
      if (!compData) continue;

      const typeName = UNITY_CLASS_IDS[compDoc.classId] ?? compDoc.typeName;

      // Extract script GUID for MonoBehaviour
      let scriptGuid: string | null = null;
      if (compDoc.classId === 114) {
        const scriptRef = compData["m_Script"] as Record<string, unknown> | undefined;
        if (scriptRef && scriptRef["guid"]) {
          scriptGuid = String(scriptRef["guid"]);
        }
      }

      // Strip defaults and remove infrastructure fields
      const stripped = stripDefaults(typeName, compData);
      delete stripped["m_GameObject"];
      if (compDoc.classId === 114) {
        delete stripped["m_Script"];
      }

      components.push({
        fileIdLocal: compFileId,
        typeName,
        scriptGuid,
        order,
        serializedFields: stripped,
        gameObjectFileId: goDoc.fileId,
      });
    }

    gameObjects.push({
      fileIdLocal: goDoc.fileId,
      name,
      parentFileIdLocal: parentGoFileId,
      active,
      layer,
      tag,
      components,
    });
  }

  return { gameObjects, references: allReferences };
}

function getDocData(doc: UnityYamlDocument): Record<string, unknown> | undefined {
  // Document data is keyed by type name, e.g. { "GameObject": {...} }
  // Try the typeName first, then the first key
  const byTypeName = doc.data[doc.typeName] as Record<string, unknown> | undefined;
  if (byTypeName) return byTypeName;
  const firstKey = Object.keys(doc.data)[0];
  if (firstKey) return doc.data[firstKey] as Record<string, unknown> | undefined;
  return undefined;
}
