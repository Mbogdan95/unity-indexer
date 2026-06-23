import { watch, type FSWatcher } from "chokidar";
import { relative } from "path";
import { existsSync } from "fs";
import type { Indexer } from "./indexer.js";
import { detectFileType } from "../types.js";

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private pendingChanges = new Map<string, "add" | "change" | "unlink">();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private bulkTimer: ReturnType<typeof setTimeout> | null = null;
  private bulkCount = 0;

  constructor(
    private indexer: Indexer,
    private projectRoot: string,
    private debounceMs: number = 500,
    private bulkThreshold: number = 50,
    private bulkWindowMs: number = 2000,
  ) {}

  start(): void {
    // Only watch Assets/ — Packages/ rarely changes and adds to fd pressure
    const assetsDir = `${this.projectRoot}/Assets`;
    if (!existsSync(assetsDir)) return;

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
    this.watcher.on("error", (err: unknown) => {
      console.error(`[unity-indexer] watcher error: ${String(err)}`);
    });
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.bulkTimer) clearTimeout(this.bulkTimer);
    void this.watcher?.close();
    this.watcher = null;
  }

  private onFileEvent(fullPath: string, event: "add" | "change" | "unlink"): void {
    const rel = relative(this.projectRoot, fullPath);
    if (!detectFileType(rel)) return;

    this.pendingChanges.set(rel, event);
    this.bulkCount++;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
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

  private flush(): void {
    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();
    // Process the whole batch at once so expensive ops (recomputeReferenceCounts,
    // updateProjectSummary) run only once instead of once per changed file.
    this.indexer.flushChanges(changes);
  }

  private handleBulkChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pendingChanges.clear();
    this.indexer.indexAll();
  }
}
