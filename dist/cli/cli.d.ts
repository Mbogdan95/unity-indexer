export type CliAction = {
    kind: "help";
} | {
    kind: "version";
} | {
    kind: "server";
    projectRoot: string | undefined;
};
export declare function parseArgs(args: string[]): CliAction;
export declare function getHelpText(version: string): string;
