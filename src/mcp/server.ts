import { existsSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "../db/store.js";
import { Indexer } from "../indexer/indexer.js";
import { FileWatcher } from "../indexer/file-watcher.js";
import { initScriptParser } from "../parsers/script-parser.js";
import { getProjectSummary, getProjectFiles } from "./resources.js";
import { registerTools, type StoreResolver } from "./tools.js";
import { registerGraphTools } from "./graph-tools.js";
import { discoverUnityProjects, ensureDbDir } from "../discovery.js";

interface ProjectInstance {
  name: string;
  projectRoot: string;
  store: Store;
  indexer: Indexer;
  watcher: FileWatcher;
}

function removeStaleJournals(dbPath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // best-effort
      }
    }
  }
}

function log(msg: string): void {
  console.error(`[unity-indexer] ${msg}`);
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${String(i)}`)) i++;
  return `${base}-${String(i)}`;
}

export async function startServer(rootDir: string): Promise<void> {
  const projectPaths = discoverUnityProjects(rootDir);

  if (projectPaths.length === 0) {
    log(`no Unity projects found under ${rootDir}`);
    process.exit(1);
  }

  log(`found ${String(projectPaths.length)} Unity project(s)`);

  const dbDir = ensureDbDir(rootDir);
  log(`database dir: ${dbDir}`);

  log("initializing C# parser...");
  await initScriptParser();

  // Phase 1: open stores and create indexers (fast — no file I/O yet)
  const projects = new Map<string, ProjectInstance>();
  const usedNames = new Set<string>();
  const toIndex: Array<{ name: string; indexer: Indexer; store: Store }> = [];

  for (const projectRoot of projectPaths) {
    const name = uniqueName(basename(projectRoot), usedNames);
    usedNames.add(name);

    const dbPath = join(dbDir, `${name}.db`);
    removeStaleJournals(dbPath);
    log(`[${name}] project: ${projectRoot}`);
    log(`[${name}] database: ${dbPath}`);

    try {
      const store = new Store(dbPath);
      const indexer = new Indexer(store, projectRoot);
      const watcher = new FileWatcher(indexer, projectRoot);
      projects.set(name, { name, projectRoot, store, indexer, watcher });
      toIndex.push({ name, indexer, store });
    } catch (err) {
      log(`[${name}] failed to initialize: ${String(err)}`);
    }
  }

  if (projects.size === 0) {
    log("all projects failed to initialize");
    process.exit(1);
  }

  const resolveStore: StoreResolver = (projectName?: string) => {
    if (projectName !== undefined && projectName !== "") {
      const p = projects.get(projectName);
      if (!p) {
        throw new Error(
          `Unknown project "${projectName}". Available: ${[...projects.keys()].join(", ")}`,
        );
      }
      return p.store;
    }
    if (projects.size === 1) {
      const first = projects.values().next().value;
      if (first === undefined) {
        throw new Error("No projects available");
      }
      return first.store;
    }
    throw new Error(
      `Multiple projects indexed. Specify "project" parameter. Available: ${[...projects.keys()].join(", ")}`,
    );
  };

  const server = new McpServer({
    name: "unity-indexer",
    version: "0.1.0",
  });

  // Register per-project resources
  for (const [name, project] of projects) {
    server.registerResource(
      `${name}-summary`,
      `unity://${name}/summary`,
      { description: `Project overview for ${name}. ~200 tokens.` },
      () => ({
        contents: [
          {
            uri: `unity://${name}/summary`,
            mimeType: "application/json",
            text: JSON.stringify(getProjectSummary(project.store), null, 2),
          },
        ],
      }),
    );

    server.registerResource(
      `${name}-files`,
      `unity://${name}/files`,
      { description: `All files in ${name} sorted by importance. Paginated.` },
      () => ({
        contents: [
          {
            uri: `unity://${name}/files`,
            mimeType: "application/json",
            text: JSON.stringify(getProjectFiles(project.store), null, 2),
          },
        ],
      }),
    );
  }

  // Top-level discovery resource
  server.registerResource(
    "projects",
    "unity://projects",
    { description: "List all indexed Unity projects." },
    () => ({
      contents: [
        {
          uri: "unity://projects",
          mimeType: "application/json",
          text: JSON.stringify(
            [...projects.values()].map((p) => ({
              name: p.name,
              path: p.projectRoot,
              summary: p.store.getProjectSummary().description,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  registerTools(server, resolveStore);
  registerGraphTools(server, resolveStore);

  // Connect transport before indexing so the MCP handshake completes immediately.
  // Tool calls arriving during indexing will block until indexAll() returns.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected — indexing projects...");

  // Phase 2: index scripts/assets synchronously, then scenes/prefabs in background
  for (const { name, indexer, store } of toIndex) {
    try {
      log(`[${name}] indexing scripts and assets...`);
      const start = Date.now();
      indexer.indexEssential();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const summary = store.getProjectSummary();
      log(
        `[${name}] scripts ready in ${elapsed}s — ${String(summary.script_count)} scripts, ${String(summary.scene_count)} scenes, ${String(summary.prefab_count)} prefabs`,
      );

      projects.get(name)?.watcher.start();
      log(`[${name}] file watcher started`);

      // Index scenes/prefabs in background — yields between batches so MCP stays responsive
      void indexer.indexScenesAndPrefabsBackground().then(() => {
        const s = store.getProjectSummary();
        log(
          `[${name}] background index complete — ${String(s.scene_count)} scenes, ${String(s.prefab_count)} prefabs`,
        );
      });
    } catch (err) {
      log(`[${name}] indexing failed: ${String(err)}`);
    }
  }

  log("MCP server ready");

  const cleanup = () => {
    for (const project of projects.values()) {
      project.watcher.stop();
      try {
        project.store.close();
      } catch {
        // best-effort
      }
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
