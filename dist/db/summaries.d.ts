import type { ParsedComponent, ParsedScript, ParsedScriptMember } from "../types.js";
/**
 * Maps each component to its display type name.
 * MonoBehaviour components with a known scriptGuid resolve to the class name.
 */
export declare function generateComponentSummary(components: ParsedComponent[], guidToClassName: Map<string, string>): string;
/**
 * Returns a human-readable summary of a GameObject and its direct children.
 * Leaf nodes return just the name; parents list up to MAX_SHOWN children.
 */
export declare function generateSubtreeSummary(name: string, childNames: string[]): string;
/**
 * Returns a compact key=value summary of serialized fields.
 * GUID references are resolved to a name or truncated guid prefix.
 */
export declare function generateFieldSummary(fields: Record<string, unknown>, guidNames?: Map<string, string>): string;
/**
 * Generates a multi-line API summary for a parsed C# script.
 * First line: "ClassName : BaseClass, Interface1, ..."
 * Subsequent lines group members by kind.
 */
export declare function generateApiSummary(script: ParsedScript): string;
/**
 * Generates a full C#-style member signature string.
 */
export declare function generateMemberSignature(member: ParsedScriptMember): string;
/**
 * Returns a single-line summary for a file, formatted by type.
 */
export declare function generateFileSummaryLine(type: string, fileName: string, stats: Record<string, unknown>): string;
/**
 * Computes an importance score [0, 1] for a GameObject.
 */
export declare function computeGameObjectImportance(stats: {
    hasMonoBehaviour: boolean;
    childCount: number;
    depth: number;
    refCount: number;
}): number;
/**
 * Computes an importance score [0, 1] for a file.
 */
export declare function computeFileImportance(stats: {
    incomingRefCount: number;
    outgoingRefCount: number;
    hasCustomScripts: boolean;
    changeFrequency: number;
}): number;
