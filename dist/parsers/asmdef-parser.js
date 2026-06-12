export function parseAsmDef(content) {
    const raw = JSON.parse(content);
    return {
        name: typeof raw.name === "string" ? raw.name : "",
        rootNamespace: typeof raw.rootNamespace === "string" ? raw.rootNamespace : "",
        references: Array.isArray(raw.references) ? raw.references : [],
        defines: Array.isArray(raw.defineConstraints) ? raw.defineConstraints : [],
        includePlatforms: Array.isArray(raw.includePlatforms) ? raw.includePlatforms : [],
        excludePlatforms: Array.isArray(raw.excludePlatforms) ? raw.excludePlatforms : [],
    };
}
//# sourceMappingURL=asmdef-parser.js.map