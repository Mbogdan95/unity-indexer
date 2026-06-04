import type { ParsedAsmDef } from "../types.js";

export function parseAsmDef(content: string): ParsedAsmDef {
  const raw = JSON.parse(content) as Record<string, unknown>;
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    rootNamespace: typeof raw.rootNamespace === "string" ? raw.rootNamespace : "",
    references: Array.isArray(raw.references) ? (raw.references as string[]) : [],
    defines: Array.isArray(raw.defineConstraints) ? (raw.defineConstraints as string[]) : [],
    includePlatforms: Array.isArray(raw.includePlatforms) ? (raw.includePlatforms as string[]) : [],
    excludePlatforms: Array.isArray(raw.excludePlatforms) ? (raw.excludePlatforms as string[]) : [],
  };
}
