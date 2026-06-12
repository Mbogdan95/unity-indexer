export type Scope = "global" | "local" | "project" | "project-local";
export declare const VALID_SCOPES: readonly Scope[];
export declare function resolveSettingsPath(scope: Scope, cwd?: string): string;
export declare function installServer(filePath: string): void;
export declare function uninstallServer(filePath: string): void;
