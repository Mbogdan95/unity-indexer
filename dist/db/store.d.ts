import { GraphManager } from "./graph.js";
import type { FileRow, GameObjectRow, ComponentRow, ScriptRow, ScriptMemberRow, GuidRow, ReferenceRow, AssemblyRow, ChangeLogRow, ProjectSummaryRow, GraphEdgeRow, GraphNodeType } from "../types.js";
export declare class Store {
    private db;
    private stmtCache;
    private pathPrefix;
    readonly graph: GraphManager;
    /** Set once at server startup: relative path from MCP rootDir to projectRoot (e.g. "MyGame"). */
    setPathPrefix(prefix: string): void;
    /** Prepend project prefix to a DB-relative path for external consumption. */
    prefixPath(p: string): string;
    /** Strip project prefix from an agent-provided path before a DB lookup. */
    stripPrefix(p: string): string;
    hydrateGraph(): void;
    private prepare;
    constructor(dbPath: string);
    close(): void;
    upsertFile(file: FileRow): number;
    getFileByPath(path: string): (FileRow & {
        id: number;
    }) | undefined;
    getFileById(id: number): (FileRow & {
        id: number;
    }) | undefined;
    listFiles(type?: string): (FileRow & {
        id: number;
    })[];
    deleteFile(fileId: number): void;
    insertGameObject(go: GameObjectRow): number;
    getGameObjectsByFile(fileId: number): (GameObjectRow & {
        id: number;
    })[];
    getGameObjectById(id: number): (GameObjectRow & {
        id: number;
    }) | undefined;
    getGameObjectByName(fileId: number, name: string): (GameObjectRow & {
        id: number;
    }) | undefined;
    resolveVariantBase(fileId: number, maxDepth?: number): number | null;
    insertComponent(comp: ComponentRow): number;
    getComponentsByGameObject(goId: number): (ComponentRow & {
        id: number;
    })[];
    getComponentsByScriptGuid(scriptGuid: string, fileId?: number): (ComponentRow & {
        id: number;
    })[];
    getComponentsByType(typeName: string, fileId?: number): (ComponentRow & {
        id: number;
    })[];
    insertScript(script: ScriptRow): number;
    listScripts(filter?: {
        namespace?: string;
        baseClass?: string;
        assembly?: string;
        isMonoBehaviour?: boolean;
    }): (ScriptRow & {
        id: number;
    })[];
    getScriptByClassName(className: string): (ScriptRow & {
        id: number;
    }) | undefined;
    getScriptByFileId(fileId: number): (ScriptRow & {
        id: number;
    }) | undefined;
    getScriptsByFileId(fileId: number): (ScriptRow & {
        id: number;
    })[];
    getScriptById(id: number): (ScriptRow & {
        id: number;
    }) | undefined;
    insertScriptMember(member: ScriptMemberRow): number;
    getScriptMembers(scriptId: number): (ScriptMemberRow & {
        id: number;
    })[];
    upsertGuid(guidRow: GuidRow): void;
    resolveGuid(guid: string): GuidRow | undefined;
    getGuidByFileId(fileId: number): GuidRow | undefined;
    getGuidToClassMap(): Map<string, string>;
    insertReference(ref: ReferenceRow): void;
    getReferencesToGuid(guid: string): (ReferenceRow & {
        id: number;
    })[];
    getReferencesFromFile(fileId: number): (ReferenceRow & {
        id: number;
    })[];
    listAssemblies(): (AssemblyRow & {
        id: number;
    })[];
    getAssemblyById(id: number): {
        id: number;
        name: string;
        path: string;
    } | undefined;
    propagateMonoBehaviourInheritance(): void;
    assignScriptAssemblies(): void;
    /** Clear all script→assembly assignments so assignScriptAssemblies() can recompute from scratch. */
    resetScriptAssemblies(): void;
    /**
     * Resolve references whose target GUID was unknown when the reference was
     * inserted (e.g. the referenced asset's .meta was indexed later). Also inserts
     * the corresponding REFERENCES_GUID graph edges. Returns the number of
     * references resolved.
     */
    resolveNullReferenceTargets(): number;
    insertAssembly(asm: AssemblyRow): number;
    insertChangeLog(entry: ChangeLogRow): void;
    getRecentChanges(limit?: number, since?: string): (ChangeLogRow & {
        id: number;
        path: string;
    })[];
    getProjectSummary(): ProjectSummaryRow;
    getProjectRootPath(): string;
    updateProjectSummary(partial: Partial<Omit<ProjectSummaryRow, "id">>): void;
    getTopReferencedFiles(limit?: number): {
        file_id: number;
        guid: string;
        incoming_count: number;
    }[];
    recomputeReferenceCounts(): void;
    deleteFileData(fileId: number): void;
    search(query: string, scope?: "files" | "game_objects" | "scripts"): {
        type: string;
        id: number;
        label: string;
        importance_score: number;
        file_path?: string;
    }[];
    insertGraphEdge(edge: GraphEdgeRow): void;
    getGraphEdgesBySource(sourceType: GraphNodeType, sourceId: number): (GraphEdgeRow & {
        id: number;
    })[];
    getGraphEdgesByTarget(targetType: GraphNodeType, targetId: number): (GraphEdgeRow & {
        id: number;
    })[];
    deleteGraphEdgesByFile(fileId: number): void;
    getAllGraphEdges(): (GraphEdgeRow & {
        id: number;
    })[];
    getGraphEdgesForFile(fileId: number): (GraphEdgeRow & {
        id: number;
    })[];
    patchGraphForFile(fileId: number, newEdges: GraphEdgeRow[]): void;
    transaction<T>(fn: () => T): T;
}
