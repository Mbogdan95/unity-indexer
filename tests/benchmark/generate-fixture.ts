/**
 * Synthetic Unity project fixture generator for benchmarking.
 *
 * Usage:
 *   npx tsx tests/benchmark/generate-fixture.ts [preset] [outDir]
 *
 * Presets: small | medium | large
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Seeded PRNG (xorshift32) — deterministic across runs
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export interface FixturePreset {
  scripts: number;
  scenes: number;
  gameObjectsPerScene: number;
  prefabs: number;
}

const PRESETS: Partial<Record<string, FixturePreset>> = {
  small: { scripts: 100, scenes: 5, gameObjectsPerScene: 50, prefabs: 20 },
  medium: { scripts: 1000, scenes: 50, gameObjectsPerScene: 100, prefabs: 200 },
  large: { scripts: 5000, scenes: 200, gameObjectsPerScene: 200, prefabs: 1000 },
};

// ---------------------------------------------------------------------------
// GUID helpers
// ---------------------------------------------------------------------------

/** Deterministic GUID: md5 of a string seed, hex-encoded, 32 chars. */
function makeGuid(seed: string): string {
  return createHash("md5").update(seed).digest("hex");
}

// ---------------------------------------------------------------------------
// C# script generator
// ---------------------------------------------------------------------------

const FIELD_TYPES = ["float", "int", "bool", "string", "GameObject", "Transform", "Vector3"];
const METHOD_NAMES = [
  "Start",
  "Update",
  "FixedUpdate",
  "OnEnable",
  "OnDisable",
  "OnDestroy",
  "Awake",
  "LateUpdate",
  "Initialize",
  "Execute",
  "Reset",
  "Apply",
];
const NAMESPACES = ["Game.Core", "Game.Player", "Game.Enemy", "Game.UI", "Game.Util"];
const BASE_CLASSES = [
  "MonoBehaviour",
  "MonoBehaviour",
  "MonoBehaviour",
  "ScriptableObject",
  "MonoBehaviour",
  "MonoBehaviour",
  "",
];

function generateScript(index: number, rng: () => number): string {
  const className = `GeneratedClass${String(index)}`;
  const ns = NAMESPACES[Math.floor(rng() * NAMESPACES.length)] ?? "Game.Core";
  const base = BASE_CLASSES[Math.floor(rng() * BASE_CLASSES.length)] ?? "";
  const isMonoBehaviour = base === "MonoBehaviour" || base === "ScriptableObject";

  const fieldCount = 2 + Math.floor(rng() * 4);
  const methodCount = 1 + Math.floor(rng() * 4);

  const fields: string[] = [];
  for (let f = 0; f < fieldCount; f++) {
    const fType = FIELD_TYPES[Math.floor(rng() * FIELD_TYPES.length)] ?? "float";
    const attr = rng() > 0.5 ? "    [SerializeField] " : "    ";
    fields.push(`${attr}private ${fType} field${String(f)} = default;`);
  }

  const methods: string[] = [];
  const usedMethods = new Set<string>();
  for (let m = 0; m < methodCount; m++) {
    let methodName = METHOD_NAMES[Math.floor(rng() * METHOD_NAMES.length)] ?? "Update";
    if (usedMethods.has(methodName)) {
      methodName = `CustomMethod${String(m)}`;
    }
    usedMethods.add(methodName);
    const access = rng() > 0.5 ? "public" : "private";
    const hasParam = rng() > 0.7;
    const paramStr = hasParam ? "int amount" : "";
    methods.push(
      `    ${access} void ${methodName}(${paramStr})\n    {\n        // generated\n    }`,
    );
  }

  const baseClause = base !== "" ? ` : ${base}` : "";
  const usings = isMonoBehaviour ? "using UnityEngine;\n" : "using System;\n";

  return [
    usings,
    `namespace ${ns}`,
    "{",
    `    public class ${className}${baseClause}`,
    "    {",
    ...fields,
    "",
    ...methods,
    "    }",
    "}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Meta file generator
// ---------------------------------------------------------------------------

function generateScriptMeta(guid: string): string {
  return [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "MonoImporter:",
    "  externalObjects: {}",
    "  serializedVersion: 2",
    "  defaultReferences: []",
    "  executionOrder: 0",
    "  icon: {instanceID: 0}",
    "  userData:",
    "  assetBundleName:",
    "  assetBundleVariant:",
    "",
  ].join("\n");
}

function generatePrefabMeta(guid: string): string {
  return [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "PrefabImporter:",
    "  externalObjects: {}",
    "  userData:",
    "  assetBundleName:",
    "  assetBundleVariant:",
    "",
  ].join("\n");
}

function generateSceneMeta(guid: string): string {
  return [
    "fileFormatVersion: 2",
    `guid: ${guid}`,
    "DefaultImporter:",
    "  externalObjects: {}",
    "  userData:",
    "  assetBundleName:",
    "  assetBundleVariant:",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Unity YAML scene / prefab generator
// ---------------------------------------------------------------------------

const UNITY_YAML_HEADER = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";

interface GameObjectEntry {
  goFileId: number;
  transformFileId: number;
  monoBehaviourFileId: number | null;
  name: string;
  scriptGuid: string | null;
}

function buildGameObjectDocs(entries: GameObjectEntry[]): string {
  const docs: string[] = [];

  for (const entry of entries) {
    const goId = String(entry.goFileId);
    const tId = String(entry.transformFileId);
    const componentList: string[] = [`  - component: {fileID: ${tId}}`];
    if (entry.monoBehaviourFileId !== null) {
      componentList.push(`  - component: {fileID: ${String(entry.monoBehaviourFileId)}}`);
    }

    docs.push(
      [
        `--- !u!1 &${goId}`,
        "GameObject:",
        "  m_ObjectHideFlags: 0",
        "  m_CorrespondingSourceObject: {fileID: 0}",
        "  m_PrefabInstance: {fileID: 0}",
        "  m_PrefabAsset: {fileID: 0}",
        "  serializedVersion: 6",
        "  m_Component:",
        componentList.join("\n"),
        "  m_Layer: 0",
        `  m_Name: ${entry.name}`,
        "  m_TagString: Untagged",
        "  m_Icon: {fileID: 0}",
        "  m_NavMeshLayer: 0",
        "  m_StaticEditorFlags: 0",
        "  m_IsActive: 1",
      ].join("\n"),
    );

    docs.push(
      [
        `--- !u!4 &${tId}`,
        "Transform:",
        "  m_ObjectHideFlags: 0",
        "  m_CorrespondingSourceObject: {fileID: 0}",
        "  m_PrefabInstance: {fileID: 0}",
        "  m_PrefabAsset: {fileID: 0}",
        `  m_GameObject: {fileID: ${goId}}`,
        "  serializedVersion: 2",
        "  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}",
        "  m_LocalPosition: {x: 0, y: 0, z: 0}",
        "  m_LocalScale: {x: 1, y: 1, z: 1}",
        "  m_Children: []",
        "  m_Father: {fileID: 0}",
        "  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}",
      ].join("\n"),
    );

    if (entry.monoBehaviourFileId !== null && entry.scriptGuid !== null) {
      const mbId = String(entry.monoBehaviourFileId);
      docs.push(
        [
          `--- !u!114 &${mbId}`,
          "MonoBehaviour:",
          "  m_ObjectHideFlags: 0",
          "  m_CorrespondingSourceObject: {fileID: 0}",
          "  m_PrefabInstance: {fileID: 0}",
          "  m_PrefabAsset: {fileID: 0}",
          `  m_GameObject: {fileID: ${goId}}`,
          "  m_Enabled: 1",
          "  m_EditorHideFlags: 0",
          `  m_Script: {fileID: 11500000, guid: ${entry.scriptGuid}, type: 3}`,
          "  m_Name:",
          "  m_EditorClassIdentifier:",
        ].join("\n"),
      );
    }
  }

  return docs.join("\n");
}

function generateScene(
  sceneIndex: number,
  gameObjectCount: number,
  scriptGuids: string[],
  rng: () => number,
): string {
  const entries: GameObjectEntry[] = [];

  for (let i = 0; i < gameObjectCount; i++) {
    // Each GO uses a block of 3 file IDs: go, transform, monobehaviour
    const base = (i + 1) * 10;
    const goFileId = base;
    const transformFileId = base + 1;
    const monoBehaviourFileId = base + 2;

    const hasScript = scriptGuids.length > 0 && rng() > 0.3;
    const scriptGuid = hasScript
      ? (scriptGuids[Math.floor(rng() * scriptGuids.length)] ?? null)
      : null;

    entries.push({
      goFileId,
      transformFileId,
      monoBehaviourFileId: hasScript ? monoBehaviourFileId : null,
      name: `GameObject_S${String(sceneIndex)}_${String(i)}`,
      scriptGuid,
    });
  }

  return UNITY_YAML_HEADER + buildGameObjectDocs(entries);
}

function generatePrefab(prefabIndex: number, scriptGuids: string[], rng: () => number): string {
  // Prefabs have fewer GOs: 1–3
  const goCount = 1 + Math.floor(rng() * 3);
  const entries: GameObjectEntry[] = [];

  for (let i = 0; i < goCount; i++) {
    const base = (i + 1) * 10;
    const hasScript = scriptGuids.length > 0 && rng() > 0.4;
    const scriptGuid = hasScript
      ? (scriptGuids[Math.floor(rng() * scriptGuids.length)] ?? null)
      : null;

    entries.push({
      goFileId: base,
      transformFileId: base + 1,
      monoBehaviourFileId: hasScript ? base + 2 : null,
      name: `PrefabRoot_${String(prefabIndex)}_${String(i)}`,
      scriptGuid,
    });
  }

  return UNITY_YAML_HEADER + buildGameObjectDocs(entries);
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateFixture(outDir: string, preset: string): void {
  const config = PRESETS[preset];
  if (!config) {
    throw new Error(
      `Unknown preset "${preset}". Valid presets: ${Object.keys(PRESETS).join(", ")}`,
    );
  }

  const rng = makeRng(42); // fixed seed for determinism
  const { scripts, scenes, gameObjectsPerScene, prefabs } = config;

  // Create directory structure
  const assetsDir = join(outDir, "Assets");
  const scriptsDir = join(assetsDir, "Scripts");
  const scenesDir = join(assetsDir, "Scenes");
  const prefabsDir = join(assetsDir, "Prefabs");
  const settingsDir = join(outDir, "ProjectSettings");

  for (const dir of [assetsDir, scriptsDir, scenesDir, prefabsDir, settingsDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // ProjectSettings/ProjectVersion.txt — required for project detection
  writeFileSync(
    join(settingsDir, "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.0f1\nm_EditorVersionWithRevision: 2022.3.0f1 (fb119bb0b476)\n",
  );

  // ------------------------------------------------------------------
  // Generate scripts
  // ------------------------------------------------------------------
  console.log(`Generating ${String(scripts)} scripts...`);
  const scriptGuids: string[] = [];

  for (let i = 0; i < scripts; i++) {
    const guid = makeGuid(`script:${String(i)}`);
    scriptGuids.push(guid);

    const className = `GeneratedClass${String(i)}`;
    const scriptContent = generateScript(i, rng);
    const scriptPath = join(scriptsDir, `${className}.cs`);
    const metaPath = `${scriptPath}.meta`;

    writeFileSync(scriptPath, scriptContent);
    writeFileSync(metaPath, generateScriptMeta(guid));
  }

  // ------------------------------------------------------------------
  // Generate prefabs
  // ------------------------------------------------------------------
  console.log(`Generating ${String(prefabs)} prefabs...`);

  for (let i = 0; i < prefabs; i++) {
    const guid = makeGuid(`prefab:${String(i)}`);
    const prefabName = `Prefab_${String(i)}`;
    const prefabPath = join(prefabsDir, `${prefabName}.prefab`);
    const metaPath = `${prefabPath}.meta`;

    const content = generatePrefab(i, scriptGuids, rng);
    writeFileSync(prefabPath, content);
    writeFileSync(metaPath, generatePrefabMeta(guid));
  }

  // ------------------------------------------------------------------
  // Generate scenes
  // ------------------------------------------------------------------
  console.log(
    `Generating ${String(scenes)} scenes with ${String(gameObjectsPerScene)} GOs each...`,
  );

  for (let i = 0; i < scenes; i++) {
    const guid = makeGuid(`scene:${String(i)}`);
    const sceneName = `Scene_${String(i)}`;
    const scenePath = join(scenesDir, `${sceneName}.unity`);
    const metaPath = `${scenePath}.meta`;

    const content = generateScene(i, gameObjectsPerScene, scriptGuids, rng);
    writeFileSync(scenePath, content);
    writeFileSync(metaPath, generateSceneMeta(guid));
  }

  const totalFiles =
    scripts * 2 + // .cs + .meta
    prefabs * 2 + // .prefab + .meta
    scenes * 2 + // .unity + .meta
    1; // ProjectVersion.txt

  console.log(`Done! Generated ${String(totalFiles)} files in: ${outDir}`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Detect if run directly via tsx/node
const argv1 = process.argv[1] ?? "";
if (argv1.endsWith("generate-fixture.ts") || argv1.endsWith("generate-fixture.js")) {
  const preset = process.argv[2] ?? "small";
  const outDir = process.argv[3] ?? `/tmp/unity-fixture-${preset}`;

  console.log(`Generating "${preset}" fixture into: ${outDir}`);
  try {
    generateFixture(outDir, preset);
  } catch (err: unknown) {
    console.error("Error:", err);
    process.exit(1);
  }
}
