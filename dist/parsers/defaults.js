// Default values for common Unity built-in component fields.
// If a field matches its default, it gets stripped from the index to save tokens.
export const COMPONENT_DEFAULTS = {
    Transform: {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        serializedVersion: 2,
        m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
        m_LocalPosition: { x: 0, y: 0, z: 0 },
        m_LocalScale: { x: 1, y: 1, z: 1 },
        m_ConstrainProportionsScale: 0,
        m_LocalEulerAnglesHint: { x: 0, y: 0, z: 0 },
    },
    RectTransform: {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        serializedVersion: 2,
        m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
        m_LocalPosition: { x: 0, y: 0, z: 0 },
        m_LocalScale: { x: 1, y: 1, z: 1 },
        m_AnchorMin: { x: 0, y: 0 },
        m_AnchorMax: { x: 0, y: 0 },
        m_AnchoredPosition: { x: 0, y: 0 },
        m_SizeDelta: { x: 0, y: 0 },
        m_Pivot: { x: 0.5, y: 0.5 },
    },
    GameObject: {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        serializedVersion: 6,
        m_Icon: { fileID: 0 },
        m_NavMeshLayer: 0,
        m_StaticEditorFlags: 0,
    },
    MonoBehaviour: {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        m_Enabled: 1,
        m_EditorHideFlags: 0,
        m_Name: "",
        m_EditorClassIdentifier: "",
    },
    Camera: {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        m_Enabled: 1,
    },
};
const ALWAYS_DEFAULT_FIELDS = new Set([
    "m_ObjectHideFlags",
    "m_CorrespondingSourceObject",
    "m_PrefabInstance",
    "m_PrefabAsset",
    "m_EditorHideFlags",
    "m_EditorClassIdentifier",
]);
export function stripDefaults(typeName, fields) {
    const defaults = COMPONENT_DEFAULTS[typeName] ?? {};
    const result = {};
    for (const [key, value] of Object.entries(fields)) {
        if (ALWAYS_DEFAULT_FIELDS.has(key))
            continue;
        if (key in defaults && deepEqual(value, defaults[key]))
            continue;
        result[key] = value;
    }
    return result;
}
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    if (typeof a === "object") {
        const aObj = a;
        const bObj = b;
        const aKeys = Object.keys(aObj);
        const bKeys = Object.keys(bObj);
        if (aKeys.length !== bKeys.length)
            return false;
        return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
    }
    return false;
}
//# sourceMappingURL=defaults.js.map