// === Parser Output Types ===
// === Unity Class ID Map (partial — most common types) ===
export const UNITY_CLASS_IDS = {
    1: "GameObject",
    2: "Component",
    4: "Transform",
    8: "Behaviour",
    12: "ParticleAnimator",
    13: "Input",
    20: "Camera",
    21: "Material",
    23: "MeshRenderer",
    25: "Renderer",
    28: "Texture2D",
    29: "OcclusionCullingSettings",
    33: "MeshFilter",
    43: "Mesh",
    48: "Shader",
    49: "TextAsset",
    50: "Rigidbody2D",
    54: "Rigidbody",
    56: "Collider",
    58: "CircleCollider2D",
    59: "HingeJoint",
    60: "PolygonCollider2D",
    61: "BoxCollider2D",
    64: "MeshCollider",
    65: "BoxCollider",
    66: "SpriteCollider2D",
    68: "EdgeCollider2D",
    70: "CapsuleCollider2D",
    72: "CompositeCollider2D",
    74: "AnimationClip",
    78: "AudioListener",
    81: "AudioSource",
    82: "AudioClip",
    83: "RenderTexture",
    84: "Cubemap",
    86: "AnimatorController",
    89: "CubemapArray",
    90: "Avatar",
    91: "AnimatorOverrideController",
    95: "Animator",
    102: "TextMesh",
    104: "RenderSettings",
    108: "Light",
    111: "Animation",
    114: "MonoBehaviour",
    115: "MonoScript",
    120: "LineRenderer",
    124: "Behaviour",
    128: "Font",
    131: "GUITexture",
    134: "PhysicMaterial",
    135: "SphereCollider",
    136: "CapsuleCollider",
    137: "SkinnedMeshRenderer",
    141: "BuildSettings",
    142: "AssetBundle",
    143: "CharacterController",
    144: "CharacterJoint",
    145: "SpringJoint",
    146: "WheelCollider",
    150: "PreloadData",
    152: "MovieTexture",
    153: "ConfigurableJoint",
    154: "TerrainCollider",
    156: "TerrainData",
    157: "LightmapSettings",
    158: "WebCamTexture",
    159: "EditorSettings",
    162: "EditorUserSettings",
    181: "AudioMixer",
    183: "AudioMixerGroup",
    184: "AudioMixerSnapshot",
    186: "AssetBundleManifest",
    187: "RuntimeInitializeOnLoadManager",
    196: "NavMeshSettings",
    198: "ParticleSystem",
    199: "ParticleSystemRenderer",
    200: "ShaderVariantCollection",
    205: "LODGroup",
    206: "BlendTree",
    207: "Motion",
    208: "NavMeshAgent",
    210: "NavMeshObstacle",
    212: "SortingGroup",
    213: "SpriteRenderer",
    214: "Sprite",
    220: "LightProbeGroup",
    222: "AnimatorStateMachine",
    225: "LightProbes",
    226: "LightProbeProxyVolume",
    228: "SpriteAtlas",
    238: "NavMeshData",
    240: "AudioMixerEffectController",
    241: "AudioMixerGroupController",
    243: "AudioMixerSnapshotController",
    245: "EventSystem",
    246: "Canvas",
    247: "CanvasGroup",
    248: "CanvasRenderer",
    249: "RectTransform",
    258: "VideoPlayer",
    290: "WindZone",
    310: "UnityConnectSettings",
    328: "VideoClip",
    329: "Terrain",
    330: "TerrainLayer",
    331: "SpriteShapeRenderer",
    363: "OcclusionArea",
    1001: "PrefabInstance",
    1101: "PrefabInstance",
};
export function detectFileType(filePath) {
    if (filePath.endsWith(".unity"))
        return "scene";
    if (filePath.endsWith(".prefab"))
        return "prefab";
    if (filePath.endsWith(".cs"))
        return "script";
    if (filePath.endsWith(".asset"))
        return "asset";
    if (filePath.endsWith(".meta"))
        return "meta";
    if (filePath.endsWith(".asmdef"))
        return "asmdef";
    return null;
}
export function encodeNodeId(type, id) {
    return `${type}:${String(id)}`;
}
export function decodeNodeId(encoded) {
    const sep = encoded.indexOf(":");
    return {
        type: encoded.slice(0, sep),
        id: Number(encoded.slice(sep + 1)),
    };
}
//# sourceMappingURL=types.js.map