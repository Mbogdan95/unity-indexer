import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Library",
  "Temp",
  "obj",
  "Logs",
  "Build",
  "Builds",
]);

export function isUnityProject(dir: string): boolean {
  return existsSync(join(dir, "Assets")) && existsSync(join(dir, "ProjectSettings"));
}

export function discoverUnityProjects(rootDir: string, maxDepth: number = 3): string[] {
  const root = resolve(rootDir);
  const results: string[] = [];
  walk(root, 0, maxDepth, results);
  results.sort();
  return results;
}

function walk(dir: string, depth: number, maxDepth: number, results: string[]): void {
  if (depth > maxDepth) return;

  if (isUnityProject(dir)) {
    results.push(dir);
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;

    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, depth + 1, maxDepth, results);
      }
    } catch {
      continue;
    }
  }
}
