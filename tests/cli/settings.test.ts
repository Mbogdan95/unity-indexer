import { describe, it, expect } from "vitest";
import { resolveSettingsPath } from "../../src/cli/settings.js";
import { join } from "path";
import { homedir } from "os";

describe("resolveSettingsPath", () => {
  it("resolves global scope to ~/.claude/settings.json", () => {
    const result = resolveSettingsPath("global");
    expect(result).toBe(join(homedir(), ".claude", "settings.json"));
  });

  it("resolves local scope to ~/.claude/settings.local.json", () => {
    const result = resolveSettingsPath("local");
    expect(result).toBe(join(homedir(), ".claude", "settings.local.json"));
  });

  it("resolves project scope to cwd/.claude/settings.json", () => {
    const result = resolveSettingsPath("project", "/tmp/my-project");
    expect(result).toBe(join("/tmp/my-project", ".claude", "settings.json"));
  });

  it("resolves project-local scope to cwd/.claude/settings.local.json", () => {
    const result = resolveSettingsPath("project-local", "/tmp/my-project");
    expect(result).toBe(join("/tmp/my-project", ".claude", "settings.local.json"));
  });

  it("uses process.cwd() for project scope when no cwd provided", () => {
    const result = resolveSettingsPath("project");
    expect(result).toBe(join(process.cwd(), ".claude", "settings.json"));
  });
});
