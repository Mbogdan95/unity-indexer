import type { UnityYamlDocument, ParsedGuidReference } from "../types.js";
/** Stringify a fileID value (string, number, or bigint) without losing precision. */
export declare function canonicalFileId(raw: unknown): string;
export declare function parseUnityYaml(content: string): UnityYamlDocument[];
export declare function extractReferences(data: Record<string, unknown>, context: string): ParsedGuidReference[];
