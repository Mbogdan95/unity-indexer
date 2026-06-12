#!/usr/bin/env node
// Ensures better-sqlite3 native binding is compiled before starting the MCP server.
// Needed when installed as a Claude Code plugin — npm skips install scripts by default.
import { existsSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binding = join(
  pluginRoot,
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
);

if (!existsSync(binding)) {
  process.stderr.write("[unity-indexer] compiling native dependencies...\n");
  try {
    execSync("npm run install", {
      cwd: join(pluginRoot, "node_modules/better-sqlite3"),
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (e) {
    process.stderr.write(
      "[unity-indexer] native dep build failed: " + e.message + "\n"
    );
  }
}

await import(new URL("./index.js", import.meta.url).href);
