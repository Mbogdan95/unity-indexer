import type { ScriptMemberRow } from "../types.js";
export interface UnusedUsing {
    name: string;
    line: number;
}
export interface UnusedField {
    name: string;
    type: string;
    line: number;
}
export interface UnusedLocal {
    name: string;
    type: string;
    line: number;
    method_name: string;
}
export interface UnusedMethod {
    name: string;
    access: string;
    signature: string;
    line: number;
    may_be_called_externally?: boolean;
}
export interface ClassUnusedResult {
    class_name: string;
    unused_fields: UnusedField[];
    unused_locals: UnusedLocal[];
    unused_methods: UnusedMethod[];
}
export interface FileUnusedResult {
    file_path: string;
    unused_usings: UnusedUsing[];
    classes: ClassUnusedResult[];
    error?: string;
}
export interface ClassInput {
    scriptId: number;
    className: string;
    isGenerated: boolean;
    members: (ScriptMemberRow & {
        id: number;
    })[];
    externalCallerClassNames: string[];
}
export interface AnalyzeFileInput {
    content: string;
    filePath: string;
    classes: ClassInput[];
}
export declare function analyzeFile(input: AnalyzeFileInput): FileUnusedResult;
