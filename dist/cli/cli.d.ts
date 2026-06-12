import type { Scope } from "./settings.js";
export type CliAction = {
    kind: "help";
} | {
    kind: "version";
} | {
    kind: "install";
    scope: Scope;
} | {
    kind: "uninstall";
    scope: Scope;
} | {
    kind: "server";
    projectRoot: string | undefined;
};
export declare function parseArgs(args: string[]): CliAction;
export declare function getHelpText(version: string): string;
