import type { Scope } from "./settings.js";
import { VALID_SCOPES } from "./settings.js";

export type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "install"; scope: Scope }
  | { kind: "uninstall"; scope: Scope }
  | { kind: "server"; projectRoot: string | undefined };

function getAt(arr: string[], i: number): string | undefined {
  return arr[i];
}

function parseScope(args: string[], index: number): Scope {
  const scopeIndex = args.indexOf("--scope", index);
  if (scopeIndex === -1) {
    return "global";
  }
  const value = getAt(args, scopeIndex + 1);
  if (value === undefined) {
    throw new Error("--scope requires a value");
  }
  if (!VALID_SCOPES.includes(value as Scope)) {
    throw new Error(`Invalid scope "${value}". Valid scopes: ${VALID_SCOPES.join(", ")}`);
  }
  return value as Scope;
}

export function parseArgs(args: string[]): CliAction {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { kind: "version" };
  }

  const command = args[0];

  if (command === "install") {
    return { kind: "install", scope: parseScope(args, 1) };
  }
  if (command === "uninstall") {
    return { kind: "uninstall", scope: parseScope(args, 1) };
  }

  return { kind: "server", projectRoot: command };
}

export function getHelpText(version: string): string {
  return `unity-indexer v${version}
Unity-specialized MCP server for token-efficient code exploration

Usage:
  unity-indexer [project-root]      Start MCP server
  unity-indexer install [options]   Register in Claude Code settings
  unity-indexer uninstall [options] Remove from Claude Code settings

Options:
  --scope <scope>  Target scope (default: global)
                   global        ~/.claude/settings.json
                   local         ~/.claude/settings.local.json
                   project       .claude/settings.json
                   project-local .claude/settings.local.json
  --help, -h       Show this help
  --version, -v    Show version`;
}
