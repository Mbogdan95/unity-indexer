import type { Store } from "../db/store.js";
import type { Benchmark } from "../benchmark.js";
export declare class Indexer {
    private store;
    private projectRoot;
    private benchmark?;
    private guidToClassCache;
    private pendingScenesAndPrefabs;
    constructor(store: Store, projectRoot: string, benchmark?: Benchmark | undefined);
    indexAll(): void;
    /**
     * Index everything except scenes/prefabs, then return.
     * Call indexScenesAndPrefabsBackground() to finish in the background.
     * Useful for server startup: scripts are available to MCP tools immediately.
     * Async so the event loop stays responsive (MCP handshake can complete between batches).
     */
    indexEssential(): Promise<void>;
    /**
     * Index scenes/prefabs in the background, yielding between batches so the
     * event loop can process MCP messages between chunks.
     * Must be called after indexEssential().
     */
    indexScenesAndPrefabsBackground(): Promise<void>;
    /**
     * Remove DB rows for files deleted while the server was not running.
     * Without this, files removed between sessions stay in the index forever.
     */
    private reconcileDeletions;
    private indexBatch;
    private indexBatchAsync;
    indexFile(relativePath: string): void;
    removeFile(relativePath: string): void;
    /**
     * Process a batch of file-change events from the FileWatcher in one pass,
     * deferring the expensive recomputeReferenceCounts / updateProjectSummary
     * to run once at the end rather than once per file.
     */
    flushChanges(changes: ReadonlyMap<string, "add" | "change" | "unlink">): void;
    private insertEdge;
    private indexFileInternal;
    private indexMeta;
    private indexScene;
    private indexPrefab;
    private indexAssetFile;
    private indexScript;
    /**
     * Second-pass: insert CALLS, SUBSCRIBES_TO, and USES edges for a script file.
     * Must be called after all scripts in the batch have been inserted so that
     * cross-class lookups (getScriptByClassName) succeed regardless of file order.
     */
    private indexScriptCrossEdges;
    private indexAsmDef;
    private storeGameObjects;
    private storeReferences;
    private buildGuidToClassMap;
    private updateProjectSummary;
    private collectFiles;
    private walkDir;
    private getModifiedTime;
}
