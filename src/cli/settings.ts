import { join } from "path";
import { homedir } from "os";

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
