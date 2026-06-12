import { readdirSync, statSync, mkdirSync, writeFileSync } from "fs";
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
function isDirectory(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
export function isUnityProject(dir) {
    return isDirectory(join(dir, "Assets")) && isDirectory(join(dir, "ProjectSettings"));
}
export function discoverUnityProjects(rootDir, maxDepth = 3) {
    const root = resolve(rootDir);
    const results = [];
    walk(root, 0, maxDepth, results);
    results.sort();
    return results;
}
export function ensureDbDir(rootDir) {
    const dir = join(rootDir, ".unity-indexer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "*\n");
    return dir;
}
function walk(dir, depth, maxDepth, results) {
    if (depth > maxDepth)
        return;
    if (isUnityProject(dir)) {
        results.push(dir);
        return;
    }
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry) || entry.startsWith("."))
            continue;
        const fullPath = join(dir, entry);
        try {
            if (statSync(fullPath).isDirectory()) {
                walk(fullPath, depth + 1, maxDepth, results);
            }
        }
        catch {
            continue;
        }
    }
}
//# sourceMappingURL=discovery.js.map