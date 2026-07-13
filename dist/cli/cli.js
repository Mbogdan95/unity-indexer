export function parseArgs(args) {
    if (args.includes("--help") || args.includes("-h")) {
        return { kind: "help" };
    }
    if (args.includes("--version") || args.includes("-v")) {
        return { kind: "version" };
    }
    return { kind: "server", projectRoot: args[0] };
}
export function getHelpText(version) {
    return `unity-indexer v${version}
Unity-specialized MCP server for token-efficient code exploration

Usage:
  unity-indexer [project-root]  Start MCP server (defaults to cwd)

Options:
  --help, -h       Show this help
  --version, -v    Show version

Installed as a Claude Code plugin, the MCP server registers automatically.`;
}
//# sourceMappingURL=cli.js.map