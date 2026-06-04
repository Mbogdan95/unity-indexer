import { parseUnityYaml, extractReferences } from "./unity-yaml.js";
import { stripDefaults } from "./defaults.js";
import type { ParsedAsset } from "../types.js";

export function parseAsset(content: string): ParsedAsset {
  const docs = parseUnityYaml(content);
  const mainDoc = docs.find((d) => d.classId === 114) ?? docs[0];
  if (!mainDoc) {
    return {
      typeName: "Unknown",
      name: "",
      scriptGuid: null,
      serializedFields: {},
      references: [],
    };
  }

  const typeName = Object.keys(mainDoc.data)[0] ?? "Unknown";
  const data = mainDoc.data[typeName] as Record<string, unknown>;
  if (!data) {
    return { typeName, name: "", scriptGuid: null, serializedFields: {}, references: [] };
  }

  const name = String(data["m_Name"] ?? "");
  let scriptGuid: string | null = null;
  const scriptRef = data["m_Script"] as Record<string, unknown> | undefined;
  if (scriptRef && scriptRef["guid"]) {
    scriptGuid = String(scriptRef["guid"]);
  }

  const stripped = stripDefaults("MonoBehaviour", data);
  delete stripped["m_GameObject"];
  delete stripped["m_Script"];
  delete stripped["m_Name"];

  const references = extractReferences(mainDoc.data, `${typeName}:${mainDoc.fileId}`);
  return { typeName, name, scriptGuid, serializedFields: stripped, references };
}
