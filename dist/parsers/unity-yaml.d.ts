import type { UnityYamlDocument, ParsedGuidReference } from "../types.js";
export declare function parseUnityYaml(content: string): UnityYamlDocument[];
export declare function extractReferences(data: Record<string, unknown>, context: string): ParsedGuidReference[];
