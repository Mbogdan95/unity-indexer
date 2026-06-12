import type { GraphEdgeType } from "../types.js";
export interface ExtractedRelationship {
    sourceClassName: string;
    edgeType: GraphEdgeType;
    targetClassName: string;
}
export declare function extractRelationships(content: string): ExtractedRelationship[];
export declare function extractTypeReferences(content: string): ExtractedRelationship[];
