import { Parser } from "web-tree-sitter";
import type { ParsedScript } from "../types.js";
export declare function initScriptParser(): Promise<void>;
export declare function getParser(): Parser | null;
export declare function parseScript(content: string): ParsedScript[];
