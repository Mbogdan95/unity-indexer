import { parseUnityYaml, extractReferences } from "./unity-yaml.js";
import { stripDefaults } from "./defaults.js";
export function parseAsset(content) {
    const docs = parseUnityYaml(content);
    if (docs.length === 0) {
        return {
            typeName: "Unknown",
            name: "",
            scriptGuid: null,
            serializedFields: {},
            references: [],
        };
    }
    const mainDoc = docs.find((d) => d.classId === 114) ?? docs[0];
    const typeName = Object.keys(mainDoc.data)[0] ?? "Unknown";
    const data = mainDoc.data[typeName];
    if (data === undefined) {
        return { typeName, name: "", scriptGuid: null, serializedFields: {}, references: [] };
    }
    const rawName = data["m_Name"];
    const name = typeof rawName === "string" ? rawName : "";
    let scriptGuid = null;
    const scriptRef = data["m_Script"];
    if (scriptRef !== undefined && typeof scriptRef["guid"] === "string") {
        scriptGuid = scriptRef["guid"];
    }
    const stripped = stripDefaults("MonoBehaviour", data);
    delete stripped["m_GameObject"];
    delete stripped["m_Script"];
    delete stripped["m_Name"];
    const references = extractReferences(mainDoc.data, `${typeName}:${mainDoc.fileId}`);
    return { typeName, name, scriptGuid, serializedFields: stripped, references };
}
//# sourceMappingURL=asset-parser.js.map