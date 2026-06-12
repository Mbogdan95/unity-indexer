#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs, getHelpText } from "./cli/cli.js";
import { resolveSettingsPath, installServer, uninstallServer } from "./cli/settings.js";
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
let action;
try {
    action = parseArgs(process.argv.slice(2));
}
catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
}
switch (action.kind) {
    case "help": {
        console.log(getHelpText(version));
        process.exit(0);
        break;
    }
    case "version": {
        console.log(version);
        process.exit(0);
        break;
    }
    case "install": {
        const filePath = resolveSettingsPath(action.scope);
        installServer(filePath);
        console.log(`Installed unity-indexer in ${action.scope} settings: ${filePath}`);
        process.exit(0);
        break;
    }
    case "uninstall": {
        try {
            const filePath = resolveSettingsPath(action.scope);
            uninstallServer(filePath);
            console.log(`Removed unity-indexer from ${action.scope} settings: ${filePath}`);
        }
        catch (err) {
            console.error(String(err instanceof Error ? err.message : err));
            process.exit(1);
        }
        process.exit(0);
        break;
    }
    case "server": {
        const rootDir = action.projectRoot !== undefined ? resolve(action.projectRoot) : process.cwd();
        const { startServer } = await import("./mcp/server.js");
        startServer(rootDir).catch((err) => {
            console.error("Failed to start unity-indexer:", err);
            process.exit(1);
        });
        break;
    }
}
//# sourceMappingURL=index.js.map