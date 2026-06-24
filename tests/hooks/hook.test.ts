import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const HOOK = join(import.meta.dirname, "../../hooks/session-start");
const ROOT = join(import.meta.dirname, "../..");

function runHook(extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "CLAUDE_PLUGIN_ROOT" && k !== "CURSOR_PLUGIN_ROOT" && v !== undefined) {
      env[k] = v;
    }
  }
  return spawnSync("bash", [HOOK], { env: { ...env, ...extraEnv }, encoding: "utf8" });
}

describe("hooks/session-start", () => {
  it("emits Claude Code JSON when CLAUDE_PLUGIN_ROOT is set", () => {
    const result = runHook({ CLAUDE_PLUGIN_ROOT: ROOT });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("unity-indexer");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("get_scene_hierarchy");
  });

  it("emits Cursor JSON when CURSOR_PLUGIN_ROOT is set", () => {
    const result = runHook({ CURSOR_PLUGIN_ROOT: ROOT });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("additional_context");
    expect(typeof parsed.additional_context).toBe("string");
    expect(parsed.additional_context).toContain("unity-indexer");
    expect(parsed.additional_context).toContain("get_scene_hierarchy");
  });

  it("exits silently with no output when no harness env var is set", () => {
    const result = runHook();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("Claude Code output is valid JSON", () => {
    const result = runHook({ CLAUDE_PLUGIN_ROOT: ROOT });
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("Cursor output is valid JSON", () => {
    const result = runHook({ CURSOR_PLUGIN_ROOT: ROOT });
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});
