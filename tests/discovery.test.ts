// tests/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { discoverUnityProjects, isUnityProject, ensureDbDir } from "../src/discovery.js";

const TMP = join(import.meta.dirname, "tmp-discovery");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function makeUnityProject(path: string): void {
  mkdirSync(join(path, "Assets"), { recursive: true });
  mkdirSync(join(path, "ProjectSettings"), { recursive: true });
}

describe("isUnityProject", () => {
  it("returns true when Assets/ and ProjectSettings/ exist", () => {
    makeUnityProject(TMP);
    expect(isUnityProject(TMP)).toBe(true);
  });

  it("returns false when only Assets/ exists", () => {
    mkdirSync(join(TMP, "Assets"), { recursive: true });
    expect(isUnityProject(TMP)).toBe(false);
  });

  it("returns false for empty directory", () => {
    expect(isUnityProject(TMP)).toBe(false);
  });
});

describe("discoverUnityProjects", () => {
  it("finds project at root level", () => {
    makeUnityProject(TMP);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([TMP]);
  });

  it("finds project nested one level deep", () => {
    const nested = join(TMP, "MyGame");
    makeUnityProject(nested);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([nested]);
  });

  it("finds multiple projects", () => {
    const game1 = join(TMP, "GameA");
    const game2 = join(TMP, "GameB");
    makeUnityProject(game1);
    makeUnityProject(game2);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([game1, game2]);
  });

  it("does not search inside a discovered project", () => {
    const outer = join(TMP, "Outer");
    makeUnityProject(outer);
    const inner = join(outer, "Assets", "Nested");
    makeUnityProject(inner);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([outer]);
  });

  it("respects max depth", () => {
    const deep = join(TMP, "a", "b", "c", "d", "MyGame");
    makeUnityProject(deep);
    const shallow = discoverUnityProjects(TMP, 3);
    expect(shallow).toEqual([]);
    const deeper = discoverUnityProjects(TMP, 5);
    expect(deeper).toEqual([deep]);
  });

  it("skips ignored directories", () => {
    const nodeModules = join(TMP, "node_modules", "SomeProject");
    makeUnityProject(nodeModules);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([]);
  });

  it("returns empty array when no projects found", () => {
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([]);
  });

  it("returns sorted results", () => {
    const z = join(TMP, "ZProject");
    const a = join(TMP, "AProject");
    makeUnityProject(z);
    makeUnityProject(a);
    const result = discoverUnityProjects(TMP);
    expect(result).toEqual([a, z]);
  });
});

describe("ensureDbDir", () => {
  it("creates .unity-indexer dir with .gitignore and returns dir path", () => {
    const dbDir = ensureDbDir(TMP);
    expect(dbDir).toBe(join(TMP, ".unity-indexer"));
    expect(existsSync(join(TMP, ".unity-indexer"))).toBe(true);
    const gitignore = readFileSync(join(TMP, ".unity-indexer", ".gitignore"), "utf8");
    expect(gitignore).toBe("*\n");
  });

  it("is idempotent", () => {
    ensureDbDir(TMP);
    const dbDir = ensureDbDir(TMP);
    expect(dbDir).toBe(join(TMP, ".unity-indexer"));
  });
});
