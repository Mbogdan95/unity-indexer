import { watch } from "chokidar";
import { relative } from "path";
import { existsSync } from "fs";
import { detectFileType } from "../types.js";
export class FileWatcher {
    indexer;
    projectRoot;
    debounceMs;
    bulkThreshold;
    bulkWindowMs;
    watcher = null;
    pendingChanges = new Map();
    debounceTimer = null;
    bulkTimer = null;
    bulkCount = 0;
    constructor(indexer, projectRoot, debounceMs = 500, bulkThreshold = 50, bulkWindowMs = 2000) {
        this.indexer = indexer;
        this.projectRoot = projectRoot;
        this.debounceMs = debounceMs;
        this.bulkThreshold = bulkThreshold;
        this.bulkWindowMs = bulkWindowMs;
    }
    start() {
        // Only watch Assets/ — Packages/ rarely changes and adds to fd pressure
        const assetsDir = `${this.projectRoot}/Assets`;
        if (!existsSync(assetsDir))
            return;
        this.watcher = watch(assetsDir, {
            ignoreInitial: true,
            persistent: true,
            usePolling: true,
            interval: 2000,
            binaryInterval: 5000,
            ignored: ["**/Library/**", "**/Temp/**", "**/obj/**", "**/*.tmp"],
        });
        this.watcher.on("add", (path) => {
            this.onFileEvent(path, "add");
        });
        this.watcher.on("change", (path) => {
            this.onFileEvent(path, "change");
        });
        this.watcher.on("unlink", (path) => {
            this.onFileEvent(path, "unlink");
        });
        this.watcher.on("error", (err) => {
            console.error(`[unity-indexer] watcher error: ${String(err)}`);
        });
    }
    stop() {
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        if (this.bulkTimer)
            clearTimeout(this.bulkTimer);
        void this.watcher?.close();
        this.watcher = null;
    }
    onFileEvent(fullPath, event) {
        const rel = relative(this.projectRoot, fullPath);
        if (!detectFileType(rel))
            return;
        this.pendingChanges.set(rel, event);
        this.bulkCount++;
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.flush();
        }, this.debounceMs);
        if (!this.bulkTimer) {
            this.bulkTimer = setTimeout(() => {
                if (this.bulkCount >= this.bulkThreshold) {
                    this.handleBulkChange();
                }
                this.bulkCount = 0;
                this.bulkTimer = null;
            }, this.bulkWindowMs);
        }
    }
    flush() {
        const changes = new Map(this.pendingChanges);
        this.pendingChanges.clear();
        // Process the whole batch at once so expensive ops (recomputeReferenceCounts,
        // updateProjectSummary) run only once instead of once per changed file.
        this.indexer.flushChanges(changes);
    }
    handleBulkChange() {
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.pendingChanges.clear();
        this.indexer.indexAll();
    }
}
//# sourceMappingURL=file-watcher.js.map