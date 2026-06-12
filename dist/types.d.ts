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
    parameters: Array<{
        name: string;
        type: string;
    }>;
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
export declare const UNITY_CLASS_IDS: Record<number, string>;
export type UnityFileType = "scene" | "prefab" | "script" | "asset" | "meta" | "asmdef";
export declare function detectFileType(filePath: string): UnityFileType | null;
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
    serialized_fields: string;
    field_summary: string;
    pattern_hash: string;
}
export interface ScriptRow {
    id?: number;
    file_id: number;
    class_name: string;
    namespace: string;
    base_class: string;
    interfaces: string;
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
    parameters: string;
    attributes: string;
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
    references: string;
    defines: string;
    platforms: string;
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
    file_counts: string;
    scene_count: number;
    prefab_count: number;
    script_count: number;
    assembly_structure: string;
    hot_scripts: string;
    recent_changes: string;
    description: string;
    indexed_at: string;
    root_path: string;
}
export type GraphNodeType = "file" | "script" | "game_object" | "component" | "assembly";
export type GraphEdgeType = "INHERITS" | "IMPLEMENTS" | "ATTACHES_TO" | "SCRIPTED_BY" | "CHILD_OF" | "DEFINED_IN" | "REFERENCES_GUID" | "VARIANT_OF" | "BELONGS_TO" | "CALLS" | "SUBSCRIBES_TO" | "ASSEMBLY_DEPENDS" | "USES";
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
export declare function encodeNodeId(type: GraphNodeType, id: number): string;
export declare function decodeNodeId(encoded: string): GraphNodeId;
