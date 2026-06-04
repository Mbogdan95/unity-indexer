#!/usr/bin/env node
import { startServer } from "./mcp/server.js";
import { resolve, join } from "path";

const projectRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const dbPath = join(projectRoot, ".unity-indexer.db");

startServer(projectRoot, dbPath).catch((err) => {
  console.error("Failed to start unity-indexer:", err);
  process.exit(1);
});
