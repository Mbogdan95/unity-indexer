import type { ParsedAsmDef } from '../types.js';

export function parseAsmDef(content: string): ParsedAsmDef {
  const raw = JSON.parse(content);
  return {
    name: raw.name ?? '',
    rootNamespace: raw.rootNamespace ?? '',
    references: raw.references ?? [],
    defines: raw.defineConstraints ?? [],
    includePlatforms: raw.includePlatforms ?? [],
    excludePlatforms: raw.excludePlatforms ?? [],
  };
}
