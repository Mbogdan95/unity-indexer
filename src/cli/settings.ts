import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export type Scope = "global" | "local" | "project" | "project-local";

export const VALID_SCOPES: readonly Scope[] = ["global", "local", "project", "project-local"];

export function resolveSettingsPath(scope: Scope, cwd?: string): string {
  const projectDir = cwd ?? process.cwd();
  switch (scope) {
    case "global":
      return join(homedir(), ".claude", "settings.json");
    case "local":
      return join(homedir(), ".claude", "settings.local.json");
    case "project":
      return join(projectDir, ".claude", "settings.json");
    case "project-local":
      return join(projectDir, ".claude", "settings.local.json");
  }
}

interface McpServerEntry {
  command: string;
  args: string[];
}

interface SettingsJson {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

const UNITY_INDEXER_ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "unity-indexer"],
};

function readSettings(filePath: string): SettingsJson {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SettingsJson;
}

function writeSettings(filePath: string, settings: SettingsJson): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
}

export function installServer(filePath: string): void {
  const settings = readSettings(filePath);
  if (settings.mcpServers === undefined) {
    settings.mcpServers = {};
  }
  settings.mcpServers["unity-indexer"] = UNITY_INDEXER_ENTRY;
  writeSettings(filePath, settings);
}
