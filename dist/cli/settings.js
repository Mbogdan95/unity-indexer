import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
export const VALID_SCOPES = ["global", "local", "project", "project-local"];
export function resolveSettingsPath(scope, cwd) {
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
const UNITY_INDEXER_ENTRY = {
    command: "npx",
    args: ["-y", "unity-indexer"],
};
function readSettings(filePath) {
    if (!existsSync(filePath)) {
        return {};
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}
function writeSettings(filePath, settings) {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
}
export function installServer(filePath) {
    const settings = readSettings(filePath);
    if (settings.mcpServers === undefined) {
        settings.mcpServers = {};
    }
    settings.mcpServers["unity-indexer"] = UNITY_INDEXER_ENTRY;
    writeSettings(filePath, settings);
}
export function uninstallServer(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Settings file not found: ${filePath}`);
    }
    const settings = readSettings(filePath);
    if (settings.mcpServers === undefined ||
        !Object.prototype.hasOwnProperty.call(settings.mcpServers, "unity-indexer")) {
        throw new Error("unity-indexer is not registered in this settings file");
    }
    delete settings.mcpServers["unity-indexer"];
    writeSettings(filePath, settings);
}
//# sourceMappingURL=settings.js.map