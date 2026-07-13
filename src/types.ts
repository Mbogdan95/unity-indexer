// === Parser Output Types ===

export interface UnityYamlDocument {
  classId: number;
  fileId: string;
  stripped: boolean;
  typeName: string;
  data: Record<string, unknown>;
}

export interface UnityReference {
  fileID: string;
  guid?: string;
  type?: number;
}

export interface ParsedGameObject {
  fileIdLocal: string;
  name: string;
  parentFileIdLocal: string | null;
  active: boolean;
  layer: number;
  tag: string;
  components: ParsedComponent[];
}

export interface ParsedComponent {
  fileIdLocal: string;
  typeName: string;
  scriptGuid: string | null;
  order: number;
  serializedFields: Record<string, unknown>;
  gameObjectFileId: string;
}

export interface ParsedScene {
  gameObjects: ParsedGameObject[];
  references: ParsedGuidReference[];
}

export interface ParsedPrefab extends ParsedScene {
  isVariant: boolean;
  sourcePrefabGuid: string | null;
}

export interface ParsedAsset {
  typeName: string;
  name: string;
  scriptGuid: string | null;
  serializedFields: Record<string, unknown>;
  references: ParsedGuidReference[];
}

export interface ParsedScript {
  className: string;
  kind: "class" | "struct" | "interface" | "enum";
  namespace: string;
  baseClass: string;
  interfaces: string[];
  members: ParsedScriptMember[];
  isMonoBehaviour: boolean;
  isEditorScript: boolean;
  isScriptableObject: boolean;
  isGenerated: boolean;
  loc: number;
}

export interface ParsedScriptMember {
  name: string;
  kind: "method" | "field" | "property" | "event" | "constructor";
  access: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  attributes: string[];
  isStatic: boolean;
  startLine: number;
  endLine: number;
}

export interface ParsedMeta {
  guid: string;
  assetType: string;
}

export interface ParsedAsmDef {
  name: string;
  rootNamespace: string;
  references: string[];
  defines: string[];
  includePlatforms: string[];
  excludePlatforms: string[];
}

export interface ParsedGuidReference {
  targetGuid: string;
  targetFileId: string;
  context: string;
  refType: "script_attachment" | "field_reference" | "prefab_variant" | "assembly_dependency";
}

// === Unity Class ID Map ===
// Generated from the official ClassIDReference (docs.unity3d.com/Manual/ClassIDReference.html).
// Used as a FALLBACK when a YAML document has no usable root key (e.g. stripped
// docs, base-class root keys like "Behaviour") — the root key takes precedence.

export const UNITY_CLASS_IDS: Record<number, string> = {
  0: "Object",
  1: "GameObject",
  2: "Component",
  3: "LevelGameManager",
  4: "Transform",
  5: "TimeManager",
  6: "GlobalGameManager",
  8: "Behaviour",
  9: "GameManager",
  11: "AudioManager",
  13: "InputManager",
  18: "EditorExtension",
  19: "Physics2DSettings",
  20: "Camera",
  21: "Material",
  23: "MeshRenderer",
  25: "Renderer",
  27: "Texture",
  28: "Texture2D",
  29: "OcclusionCullingSettings",
  30: "GraphicsSettings",
  33: "MeshFilter",
  41: "OcclusionPortal",
  43: "Mesh",
  45: "Skybox",
  47: "QualitySettings",
  48: "Shader",
  49: "TextAsset",
  50: "Rigidbody2D",
  53: "Collider2D",
  54: "Rigidbody",
  55: "PhysicsManager",
  56: "Collider",
  57: "Joint",
  58: "CircleCollider2D",
  59: "HingeJoint",
  60: "PolygonCollider2D",
  61: "BoxCollider2D",
  62: "PhysicsMaterial2D",
  64: "MeshCollider",
  65: "BoxCollider",
  66: "CompositeCollider2D",
  68: "EdgeCollider2D",
  70: "CapsuleCollider2D",
  72: "ComputeShader",
  74: "AnimationClip",
  75: "ConstantForce",
  78: "TagManager",
  81: "AudioListener",
  82: "AudioSource",
  83: "AudioClip",
  84: "RenderTexture",
  86: "CustomRenderTexture",
  89: "Cubemap",
  90: "Avatar",
  91: "AnimatorController",
  93: "RuntimeAnimatorController",
  95: "Animator",
  96: "TrailRenderer",
  102: "TextMesh",
  104: "RenderSettings",
  108: "Light",
  111: "Animation",
  114: "MonoBehaviour",
  115: "MonoScript",
  117: "Texture3D",
  119: "Projector",
  120: "LineRenderer",
  121: "Flare",
  122: "Halo",
  123: "LensFlare",
  124: "FlareLayer",
  126: "NavMeshProjectSettings",
  128: "Font",
  129: "PlayerSettings",
  130: "NamedObject",
  134: "PhysicsMaterial",
  135: "SphereCollider",
  136: "CapsuleCollider",
  137: "SkinnedMeshRenderer",
  138: "FixedJoint",
  141: "BuildSettings",
  142: "AssetBundle",
  143: "CharacterController",
  144: "CharacterJoint",
  145: "SpringJoint",
  146: "WheelCollider",
  147: "ResourceManager",
  150: "PreloadData",
  152: "MovieTexture",
  153: "ConfigurableJoint",
  154: "TerrainCollider",
  156: "TerrainData",
  157: "LightmapSettings",
  158: "WebCamTexture",
  159: "EditorSettings",
  162: "EditorUserSettings",
  164: "AudioReverbFilter",
  165: "AudioHighPassFilter",
  166: "AudioChorusFilter",
  167: "AudioReverbZone",
  168: "AudioEchoFilter",
  169: "AudioLowPassFilter",
  170: "AudioDistortionFilter",
  171: "SparseTexture",
  180: "AudioBehaviour",
  181: "AudioFilter",
  182: "WindZone",
  183: "Cloth",
  187: "Texture2DArray",
  188: "CubemapArray",
  191: "OffMeshLink",
  192: "OcclusionArea",
  193: "Tree",
  195: "NavMeshAgent",
  196: "NavMeshSettings",
  198: "ParticleSystem",
  199: "ParticleSystemRenderer",
  200: "ShaderVariantCollection",
  205: "LODGroup",
  206: "BlendTree",
  207: "Motion",
  208: "NavMeshObstacle",
  210: "SortingGroup",
  212: "SpriteRenderer",
  213: "Sprite",
  214: "CachedSpriteAtlas",
  215: "ReflectionProbe",
  218: "Terrain",
  220: "LightProbeGroup",
  221: "AnimatorOverrideController",
  222: "CanvasRenderer",
  223: "Canvas",
  224: "RectTransform",
  225: "CanvasGroup",
  226: "BillboardAsset",
  227: "BillboardRenderer",
  228: "SpeedTreeWindAsset",
  229: "AnchoredJoint2D",
  230: "Joint2D",
  231: "SpringJoint2D",
  232: "DistanceJoint2D",
  233: "HingeJoint2D",
  234: "SliderJoint2D",
  235: "WheelJoint2D",
  238: "NavMeshData",
  240: "AudioMixer",
  241: "AudioMixerController",
  243: "AudioMixerGroupController",
  244: "AudioMixerEffectController",
  245: "AudioMixerSnapshotController",
  246: "PhysicsUpdateBehaviour2D",
  247: "ConstantForce2D",
  248: "Effector2D",
  249: "AreaEffector2D",
  250: "PointEffector2D",
  251: "PlatformEffector2D",
  252: "SurfaceEffector2D",
  253: "BuoyancyEffector2D",
  254: "RelativeJoint2D",
  255: "FixedJoint2D",
  256: "FrictionJoint2D",
  257: "TargetJoint2D",
  258: "LightProbes",
  259: "LightProbeProxyVolume",
  271: "SampleClip",
  272: "AudioMixerSnapshot",
  273: "AudioMixerGroup",
  290: "AssetBundleManifest",
  300: "RuntimeInitializeOnLoadManager",
  310: "UnityConnectSettings",
  319: "AvatarMask",
  320: "PlayableDirector",
  328: "VideoPlayer",
  329: "VideoClip",
  330: "ParticleSystemForceField",
  331: "SpriteMask",
  363: "OcclusionCullingData",
  1001: "PrefabInstance",
  1002: "EditorExtensionImpl",
  1003: "AssetImporter",
  1029: "DefaultAsset",
  1032: "SceneAsset",
  1101: "AnimatorStateTransition",
  1102: "AnimatorState",
  1105: "HumanTemplate",
  1107: "AnimatorStateMachine",
  1109: "AnimatorTransition",
  1111: "AnimatorTransitionBase",
  1113: "LightmapParameters",
  1120: "LightingDataAsset",
  // Hash-based IDs (newer components)
  19719996: "TilemapCollider2D",
  73398921: "VFXRenderer",
  156049354: "Grid",
  171741748: "ArticulationBody",
  181963792: "Preset",
  285090594: "IConstraint",
  483693784: "TilemapRenderer",
  612988286: "SpriteAtlasAsset",
  638013454: "SpriteAtlasDatabase",
  687078895: "SpriteAtlas",
  850595691: "LightingSettings",
  893571522: "CustomCollider2D",
  895512359: "AimConstraint",
  1001480554: "Prefab",
  1152215463: "AssemblyDefinitionAsset",
  1183024399: "LookAtConstraint",
  1480428607: "LowerResBlitTexture",
  1542919678: "StreamingController",
  1660057539: "SceneRoots",
  1742807556: "GridLayout",
  1773428102: "ParentConstraint",
  1818360608: "PositionConstraint",
  1818360609: "RotationConstraint",
  1818360610: "ScaleConstraint",
  1839735485: "Tilemap",
  1953259897: "TerrainLayer",
  1971053207: "SpriteShapeRenderer",
  2083052967: "VisualEffect",
  2083778819: "LocalizationAsset",
  2089858483: "ScriptedImporter",
};

// === File Type Detection ===

export type UnityFileType = "scene" | "prefab" | "script" | "asset" | "meta" | "asmdef";

export function detectFileType(filePath: string): UnityFileType | null {
  if (filePath.endsWith(".unity")) return "scene";
  if (filePath.endsWith(".prefab")) return "prefab";
  if (filePath.endsWith(".cs")) return "script";
  if (filePath.endsWith(".asset")) return "asset";
  if (filePath.endsWith(".meta")) return "meta";
  if (filePath.endsWith(".asmdef")) return "asmdef";
  return null;
}

// === Database Row Types ===

export interface FileRow {
  id?: number;
  path: string;
  type: UnityFileType;
  content_hash: string;
  modified_at: string;
  indexed_at: string;
  summary_line: string;
  importance_score: number;
  status: "ok" | "partial" | "binary" | "error";
  source_prefab_guid?: string | null;
}

export interface GameObjectRow {
  id?: number;
  file_id: number;
  file_id_local: string;
  name: string;
  parent_file_id_local: string | null;
  depth: number;
  sibling_index: number;
  active: boolean;
  layer: number;
  tag: string;
  component_summary: string;
  subtree_summary: string;
  is_leaf: boolean;
  child_count: number;
  subtree_depth: number;
  importance_score: number;
}

export interface ComponentRow {
  id?: number;
  game_object_id: number;
  type_name: string;
  script_guid: string | null;
  order: number;
  serialized_fields: string; // JSON
  field_summary: string;
  pattern_hash: string;
}

export interface ScriptRow {
  id?: number;
  file_id: number;
  class_name: string;
  namespace: string;
  base_class: string;
  interfaces: string; // JSON array
  assembly_name: string;
  api_summary: string;
  complexity_score: number;
  is_monobehaviour: boolean;
  is_editor_script: boolean;
  is_scriptable_object: boolean;
  is_generated: boolean;
}

export interface ScriptMemberRow {
  id?: number;
  script_id: number;
  name: string;
  kind: string;
  access: string;
  return_type: string;
  parameters: string; // JSON
  attributes: string; // JSON
  signature: string;
  has_serialize_field: boolean;
  has_header_attr: boolean;
  start_line: number;
  end_line: number;
}

export interface GuidRow {
  guid: string;
  file_id: number;
  asset_type: string;
}

export interface ReferenceRow {
  id?: number;
  source_file_id: number;
  source_context: string;
  target_guid: string;
  target_file_id: number | null;
  ref_type: string;
}

export interface ReferenceCountRow {
  file_id: number;
  guid: string;
  incoming_count: number;
  outgoing_count: number;
}

export interface AssemblyRow {
  id?: number;
  file_id: number;
  name: string;
  references: string; // JSON
  defines: string; // JSON
  platforms: string; // JSON
  dependency_summary: string;
}

export interface ChangeLogRow {
  id?: number;
  file_id: number;
  changed_at: string;
  change_type: "added" | "modified" | "deleted";
}

export interface ProjectSummaryRow {
  id: number;
  file_counts: string; // JSON
  scene_count: number;
  prefab_count: number;
  script_count: number;
  assembly_structure: string; // JSON
  hot_scripts: string; // JSON
  recent_changes: string; // JSON
  description: string;
  indexed_at: string;
  root_path: string;
}

export type GraphNodeType = "file" | "script" | "game_object" | "component" | "assembly";

export type GraphEdgeType =
  | "INHERITS"
  | "IMPLEMENTS"
  | "ATTACHES_TO"
  | "SCRIPTED_BY"
  | "CHILD_OF"
  | "DEFINED_IN"
  | "REFERENCES_GUID"
  | "VARIANT_OF"
  | "BELONGS_TO"
  | "CALLS"
  | "SUBSCRIBES_TO"
  | "ASSEMBLY_DEPENDS"
  | "USES";

export interface GraphEdgeRow {
  id?: number;
  source_type: GraphNodeType;
  source_id: number;
  target_type: GraphNodeType;
  target_id: number;
  edge_type: GraphEdgeType;
  metadata: string | null;
  source_file_id: number | null;
}

export interface GraphNodeId {
  type: GraphNodeType;
  id: number;
}

export function encodeNodeId(type: GraphNodeType, id: number): string {
  return `${type}:${String(id)}`;
}

export function decodeNodeId(encoded: string): GraphNodeId {
  const sep = encoded.indexOf(":");
  return {
    type: encoded.slice(0, sep) as GraphNodeType,
    id: Number(encoded.slice(sep + 1)),
  };
}
