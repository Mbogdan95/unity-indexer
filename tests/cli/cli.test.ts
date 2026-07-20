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

  it("returns server action for no args", () => {
    expect(parseArgs([])).toEqual({ kind: "server", projectRoot: undefined });
  });

  it("returns server action with project root positional", () => {
    expect(parseArgs(["/some/path"])).toEqual({ kind: "server", projectRoot: "/some/path" });
  });
});
