import type { UnityYamlDocument, ParsedScene } from "../types.js";
export declare function parseScene(content: string): ParsedScene;
export declare function buildScene(docs: UnityYamlDocument[]): ParsedScene;
