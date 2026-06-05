import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/cli/cli.js";

describe("parseArgs", () => {
  it("returns help action for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("returns help action for -h", () => {
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("returns version action for --version", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("returns version action for -v", () => {
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("returns install action with default global scope", () => {
    expect(parseArgs(["install"])).toEqual({ kind: "install", scope: "global" });
  });

  it("returns install action with specified scope", () => {
    expect(parseArgs(["install", "--scope", "project"])).toEqual({
      kind: "install",
      scope: "project",
    });
  });

  it("returns install action with project-local scope", () => {
    expect(parseArgs(["install", "--scope", "project-local"])).toEqual({
      kind: "install",
      scope: "project-local",
    });
  });

  it("returns help action for install --help", () => {
    expect(parseArgs(["install", "--help"])).toEqual({ kind: "help" });
  });

  it("returns uninstall action with default global scope", () => {
    expect(parseArgs(["uninstall"])).toEqual({ kind: "uninstall", scope: "global" });
  });

  it("returns uninstall action with specified scope", () => {
    expect(parseArgs(["uninstall", "--scope", "local"])).toEqual({
      kind: "uninstall",
      scope: "local",
    });
  });

  it("throws for invalid scope", () => {
    expect(() => {
      parseArgs(["install", "--scope", "invalid"]);
    }).toThrow("Invalid scope");
  });

  it("throws for --scope without value", () => {
    expect(() => {
      parseArgs(["install", "--scope"]);
    }).toThrow("--scope requires a value");
  });

  it("returns server action for no args", () => {
    expect(parseArgs([])).toEqual({ kind: "server", projectRoot: undefined });
  });

  it("returns server action with project root for unknown positional", () => {
    expect(parseArgs(["/some/path"])).toEqual({ kind: "server", projectRoot: "/some/path" });
  });
});
