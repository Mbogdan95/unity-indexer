#!/usr/bin/env node
import { startServer } from "./mcp/server.js";
import { resolve } from "path";

const rootDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

startServer(rootDir).catch((err: unknown) => {
  console.error("Failed to start unity-indexer:", err);
  process.exit(1);
});
