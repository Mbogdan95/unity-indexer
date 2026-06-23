import type { Node } from "web-tree-sitter";
import type { GraphEdgeType } from "../types.js";
export interface ExtractedRelationship {
    sourceClassName: string;
    edgeType: GraphEdgeType;
    targetClassName: string;
}
/**
 * Walk all descendants of a node, calling visitor for each.
 */
export declare function walkAll(node: Node, visitor: (n: Node) => void): void;
/**
 * Collect all class/struct names declared in the file so we can map
 * method bodies back to their containing class.
 */
export interface ClassBodyRange {
    className: string;
    startIndex: number;
    endIndex: number;
}
export declare function collectClassBodies(root: Node): ClassBodyRange[];
export declare function findSourceClass(index: number, classBodies: ClassBodyRange[]): string;
export declare function extractRelationships(content: string): ExtractedRelationship[];
export declare function extractTypeReferences(content: string): ExtractedRelationship[];
