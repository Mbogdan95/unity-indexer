import { existsSync, unlinkSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "../db/store.js";
import { Indexer } from "../indexer/indexer.js";
import { FileWatcher } from "../indexer/file-watcher.js";
import { initScriptParser } from "../parsers/script-parser.js";
import { getProjectSummary, getProjectFiles } from "./resources.js";
import { registerTools } from "./tools.js";

function removeStaleJournals(dbPath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // Stale journal removal is best-effort
      }
    }
  }
}

function log(msg: string): void {
  console.error(`[unity-indexer] ${msg}`);
}

export async function startServer(projectRoot: string, dbPath: string): Promise<void> {
  removeStaleJournals(dbPath);
  log(`project: ${projectRoot}`);
  log(`database: ${dbPath}`);

  log("initializing C# parser...");
  await initScriptParser();

  const store = new Store(dbPath);
  const indexer = new Indexer(store, projectRoot);

  log("indexing project...");
  const start = Date.now();
  indexer.indexAll();
  const summary = store.getProjectSummary();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(
    `indexed in ${elapsed}s — ${String(summary.scene_count)} scenes, ${String(summary.prefab_count)} prefabs, ${String(summary.script_count)} scripts`,
  );

  const watcher = new FileWatcher(indexer, projectRoot);
  watcher.start();
  log("file watcher started");

  const server = new McpServer({
    name: "unity-indexer",
    version: "0.1.0",
  });

  server.registerResource(
    "project-summary",
    "unity://project/summary",
    { description: "Project overview — read this first. ~200 tokens." },
    () => ({
      contents: [
        {
          uri: "unity://project/summary",
          mimeType: "application/json",
          text: JSON.stringify(getProjectSummary(store), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "project-files",
    "unity://project/files",
    { description: "All project files sorted by importance. Paginated." },
    () => ({
      contents: [
        {
          uri: "unity://project/files",
          mimeType: "application/json",
          text: JSON.stringify(getProjectFiles(store), null, 2),
        },
      ],
    }),
  );

  registerTools(server, store);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server ready");

  const cleanup = () => {
    watcher.stop();
    try {
      store.close();
    } catch {
      // Best-effort cleanup on shutdown
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("beforeExit", cleanup);
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanup();
    process.exit(1);
  });
}
