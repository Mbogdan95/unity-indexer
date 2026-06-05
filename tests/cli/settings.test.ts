import { describe, it, expect } from "vitest";
import { resolveSettingsPath, installServer, uninstallServer } from "../../src/cli/settings.js";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";

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

describe("installServer", () => {
  function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "unity-indexer-test-"));
  }

  it("creates settings file when it does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, ".claude", "settings.json");
    installServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("preserves existing mcpServers entries", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { "other-server": { command: "other", args: [] } } }),
    );
    installServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("preserves non-mcpServers settings", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(filePath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
    installServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.permissions).toEqual({ allow: ["Bash(ls)"] });
  });

  it("overwrites existing unity-indexer entry (idempotent)", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { "unity-indexer": { command: "old", args: ["old"] } } }),
    );
    installServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toEqual({
      command: "npx",
      args: ["-y", "unity-indexer"],
    });
  });

  it("creates parent directories when they do not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "nested", "deep", "settings.json");
    installServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toBeDefined();
  });
});

describe("uninstallServer", () => {
  function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "unity-indexer-test-"));
  }

  it("removes unity-indexer entry from mcpServers", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          "unity-indexer": { command: "npx", args: ["-y", "unity-indexer"] },
          "other-server": { command: "other", args: [] },
        },
      }),
    );
    uninstallServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.mcpServers["unity-indexer"]).toBeUndefined();
    expect(content.mcpServers["other-server"]).toEqual({ command: "other", args: [] });
  });

  it("preserves non-mcpServers settings", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        permissions: { allow: [] },
        mcpServers: { "unity-indexer": { command: "npx", args: ["-y", "unity-indexer"] } },
      }),
    );
    uninstallServer(filePath);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.permissions).toEqual({ allow: [] });
  });

  it("throws when settings file does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "nonexistent.json");
    expect(() => {
      uninstallServer(filePath);
    }).toThrow("Settings file not found");
  });

  it("throws when unity-indexer is not in mcpServers", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { "other-server": { command: "other", args: [] } } }),
    );
    expect(() => {
      uninstallServer(filePath);
    }).toThrow("unity-indexer is not registered");
  });

  it("throws when mcpServers key does not exist", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "settings.json");
    writeFileSync(filePath, JSON.stringify({ permissions: {} }));
    expect(() => {
      uninstallServer(filePath);
    }).toThrow("unity-indexer is not registered");
  });
});
