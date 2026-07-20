import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../db/store.js";
export type StoreResolver = (projectName?: string) => Store;
export declare function handleGetSceneHierarchy(store: Store, params: {
    scene: string;
    depth?: number;
    filter?: string;
}): object;
export declare function handleGetPrefabStructure(store: Store, params: {
    prefab: string;
    depth?: number;
    filter?: string;
}): object;
export declare function handleListScripts(store: Store, params: {
    namespace?: string;
    base_class?: string;
    assembly?: string;
    is_monobehaviour?: boolean;
    limit?: number;
}): object;
export declare function handleListAssets(store: Store, params: {
    type?: string;
    limit?: number;
}): object;
export declare function handleGetGameObject(store: Store, params: {
    scene: string;
    name_or_id: string;
}): object;
export declare function handleGetComponent(store: Store, params: {
    scene: string;
    game_object: string;
    component_type: string;
}): object;
export declare function handleGetScriptDetail(store: Store, params: {
    class_name: string;
}): object;
export declare function handleGetScriptMember(store: Store, params: {
    class_name: string;
    member_name: string;
}): object;
export declare function handleFindReferences(store: Store, params: {
    guid_or_name: string;
    depth?: number;
    limit?: number;
}): object;
export declare function handleFindDependencies(store: Store, params: {
    guid_or_name: string;
    depth?: number;
    limit?: number;
}): object;
export declare function handleResolveGuid(store: Store, params: {
    guid: string;
}): object;
export declare function handleSearch(store: Store, params: {
    query: string;
    scope?: "files" | "game_objects" | "scripts";
}): object;
export declare function handleFindComponents(store: Store, params: {
    type: string;
    scene?: string;
    limit?: number;
}): object;
export declare function handleRecentChanges(store: Store, params: {
    since?: string;
    limit?: number;
}): object;
export declare function handleBatchGetScriptDetail(store: Store, params: {
    class_names: string[];
}): object;
export declare function handleFindUnused(store: Store, params: {
    class_name?: string;
    file_path?: string;
    namespace?: string;
    assembly?: string;
}): object;
export declare function registerTools(server: McpServer, resolveStore: StoreResolver): void;
