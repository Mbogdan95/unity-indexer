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

// === Unity Class ID Map (partial — most common types) ===

export const UNITY_CLASS_IDS: Record<number, string> = {
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
  | "ASSEMBLY_DEPENDS";

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
