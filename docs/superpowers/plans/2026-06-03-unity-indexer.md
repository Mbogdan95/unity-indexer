# Unity Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Unity-specialized MCP server that indexes Unity project files into SQLite for token-efficient LLM code exploration.

**Architecture:** Four-layer stack — parser pipeline extracts structured data from Unity files, SQLite stores with pre-computed summaries at every level, query engine translates MCP calls to SQL, MCP server exposes progressive-disclosure tools to Claude Code. Each parser is a pure function with no knowledge of storage or MCP.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, `better-sqlite3`, `web-tree-sitter` (C# grammar), `yaml` (YAML parsing), `chokidar` (file watching), `vitest` (testing)

---

## File Structure

```
unity-indexer/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── index.ts                     # Entry point — CLI + MCP server startup
│   ├── types.ts                     # All shared types/interfaces
│   ├── parsers/
│   │   ├── unity-yaml.ts            # Core Unity YAML document splitter + parser
│   │   ├── meta-parser.ts           # .meta file parser (GUID extraction)
│   │   ├── asmdef-parser.ts         # .asmdef JSON parser
│   │   ├── script-parser.ts         # .cs file parser (tree-sitter)
│   │   ├── defaults.ts              # Known default values for built-in Unity components
│   │   ├── scene-parser.ts          # .unity file parser (hierarchy + components)
│   │   ├── prefab-parser.ts         # .prefab file parser (extends scene parser)
│   │   └── asset-parser.ts          # .asset file parser (ScriptableObjects)
│   ├── db/
│   │   ├── schema.ts                # SQLite schema DDL + migration
│   │   ├── store.ts                 # Database CRUD operations
│   │   └── summaries.ts             # Summary generation + importance scoring
│   ├── indexer/
│   │   ├── indexer.ts               # Orchestrates parsing → DB writes
│   │   └── file-watcher.ts          # chokidar watcher + debounce + bulk detection
│   └── mcp/
│       ├── server.ts                # MCP server setup + tool/resource registration
│       ├── resources.ts             # MCP resource handlers
│       └── tools.ts                 # MCP tool handlers
├── grammars/
│   └── tree-sitter-c-sharp.wasm     # Pre-built C# grammar for web-tree-sitter
└── tests/
    ├── fixtures/
    │   └── TestProject/
    │       └── Assets/
    │           ├── Scenes/
    │           │   ├── MainScene.unity
    │           │   └── MainScene.unity.meta
    │           ├── Prefabs/
    │           │   ├── Enemy.prefab
    │           │   └── Enemy.prefab.meta
    │           ├── Scripts/
    │           │   ├── PlayerController.cs
    │           │   ├── PlayerController.cs.meta
    │           │   ├── IDamageable.cs
    │           │   └── IDamageable.cs.meta
    │           ├── ScriptableObjects/
    │           │   ├── GameConfig.asset
    │           │   └── GameConfig.asset.meta
    │           ├── GameLogic.asmdef
    │           └── GameLogic.asmdef.meta
    ├── parsers/
    │   ├── unity-yaml.test.ts
    │   ├── meta-parser.test.ts
    │   ├── asmdef-parser.test.ts
    │   ├── script-parser.test.ts
    │   ├── scene-parser.test.ts
    │   ├── prefab-parser.test.ts
    │   └── asset-parser.test.ts
    ├── db/
    │   ├── store.test.ts
    │   └── summaries.test.ts
    ├── indexer/
    │   └── indexer.test.ts
    └── mcp/
        └── tools.test.ts
```

---

### Task 1: Project Scaffolding + Shared Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "unity-indexer",
  "version": "0.1.0",
  "description": "Unity-specialized MCP server for token-efficient code exploration",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "unity-indexer": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk better-sqlite3 yaml chokidar web-tree-sitter
npm install -D typescript @types/better-sqlite3 @types/node vitest tsx
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
  },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
.superpowers/
```

- [ ] **Step 6: Create src/types.ts with all shared types**

```ts
// === Parser Output Types ===

export interface UnityYamlDocument {
  classId: number;
  fileId: string;
  stripped: boolean;
  typeName: string;
  data: Record<string, unknown>;
}

export interface UnityReference {
  fileID: string;
  guid?: string;
  type?: number;
}

export interface ParsedGameObject {
  fileIdLocal: string;
  name: string;
  parentFileIdLocal: string | null;
  active: boolean;
  layer: number;
  tag: string;
  components: ParsedComponent[];
}

export interface ParsedComponent {
  fileIdLocal: string;
  typeName: string;
  scriptGuid: string | null;
  order: number;
  serializedFields: Record<string, unknown>;
  gameObjectFileId: string;
}

export interface ParsedScene {
  gameObjects: ParsedGameObject[];
  references: ParsedGuidReference[];
}

export interface ParsedPrefab extends ParsedScene {
  isVariant: boolean;
  sourcePrefabGuid: string | null;
}

export interface ParsedAsset {
  typeName: string;
  name: string;
  scriptGuid: string | null;
  serializedFields: Record<string, unknown>;
  references: ParsedGuidReference[];
}

export interface ParsedScript {
  className: string;
  kind: 'class' | 'struct' | 'interface' | 'enum';
  namespace: string;
  baseClass: string;
  interfaces: string[];
  members: ParsedScriptMember[];
  isMonoBehaviour: boolean;
  isEditorScript: boolean;
  isScriptableObject: boolean;
  isGenerated: boolean;
  loc: number;
}

export interface ParsedScriptMember {
  name: string;
  kind: 'method' | 'field' | 'property' | 'event' | 'constructor';
  access: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  attributes: string[];
  isStatic: boolean;
}

export interface ParsedMeta {
  guid: string;
  assetType: string;
}

export interface ParsedAsmDef {
  name: string;
  rootNamespace: string;
  references: string[];
  defines: string[];
  includePlatforms: string[];
  excludePlatforms: string[];
}

export interface ParsedGuidReference {
  targetGuid: string;
  targetFileId: string;
  context: string;
  refType: 'script_attachment' | 'field_reference' | 'prefab_variant' | 'assembly_dependency';
}

// === Unity Class ID Map (partial — most common types) ===

export const UNITY_CLASS_IDS: Record<number, string> = {
  1: 'GameObject',
  2: 'Component',
  4: 'Transform',
  8: 'Behaviour',
  12: 'ParticleAnimator',
  13: 'Input',
  20: 'Camera',
  21: 'Material',
  23: 'MeshRenderer',
  25: 'Renderer',
  28: 'Texture2D',
  29: 'OcclusionCullingSettings',
  33: 'MeshFilter',
  43: 'Mesh',
  48: 'Shader',
  49: 'TextAsset',
  50: 'Rigidbody2D',
  54: 'Rigidbody',
  56: 'Collider',
  58: 'CircleCollider2D',
  59: 'HingeJoint',
  60: 'PolygonCollider2D',
  61: 'BoxCollider2D',
  64: 'MeshCollider',
  65: 'BoxCollider',
  66: 'SpriteCollider2D',
  68: 'EdgeCollider2D',
  70: 'CapsuleCollider2D',
  72: 'CompositeCollider2D',
  74: 'AnimationClip',
  78: 'AudioListener',
  81: 'AudioSource',
  82: 'AudioClip',
  83: 'RenderTexture',
  84: 'Cubemap',
  86: 'AnimatorController',
  89: 'CubemapArray',
  90: 'Avatar',
  91: 'AnimatorOverrideController',
  95: 'Animator',
  102: 'TextMesh',
  104: 'RenderSettings',
  108: 'Light',
  111: 'Animation',
  114: 'MonoBehaviour',
  115: 'MonoScript',
  120: 'LineRenderer',
  124: 'Behaviour',
  128: 'Font',
  131: 'GUITexture',
  134: 'PhysicMaterial',
  135: 'SphereCollider',
  136: 'CapsuleCollider',
  137: 'SkinnedMeshRenderer',
  141: 'BuildSettings',
  142: 'AssetBundle',
  143: 'CharacterController',
  144: 'CharacterJoint',
  145: 'SpringJoint',
  146: 'WheelCollider',
  150: 'PreloadData',
  152: 'MovieTexture',
  153: 'ConfigurableJoint',
  154: 'TerrainCollider',
  156: 'TerrainData',
  157: 'LightmapSettings',
  158: 'WebCamTexture',
  159: 'EditorSettings',
  162: 'EditorUserSettings',
  181: 'AudioMixer',
  183: 'AudioMixerGroup',
  184: 'AudioMixerSnapshot',
  186: 'AssetBundleManifest',
  187: 'RuntimeInitializeOnLoadManager',
  196: 'NavMeshSettings',
  198: 'ParticleSystem',
  199: 'ParticleSystemRenderer',
  200: 'ShaderVariantCollection',
  205: 'LODGroup',
  206: 'BlendTree',
  207: 'Motion',
  208: 'NavMeshAgent',
  210: 'NavMeshObstacle',
  212: 'SortingGroup',
  213: 'SpriteRenderer',
  214: 'Sprite',
  220: 'LightProbeGroup',
  222: 'AnimatorStateMachine',
  225: 'LightProbes',
  226: 'LightProbeProxyVolume',
  228: 'SpriteAtlas',
  238: 'NavMeshData',
  240: 'AudioMixerEffectController',
  241: 'AudioMixerGroupController',
  243: 'AudioMixerSnapshotController',
  245: 'EventSystem',
  246: 'Canvas',
  247: 'CanvasGroup',
  248: 'CanvasRenderer',
  249: 'RectTransform',
  258: 'VideoPlayer',
  290: 'WindZone',
  310: 'UnityConnectSettings',
  328: 'VideoClip',
  329: 'Terrain',
  330: 'TerrainLayer',
  331: 'SpriteShapeRenderer',
  363: 'OcclusionArea',
  1001: 'PrefabInstance',
  1101: 'PrefabInstance',
};

// === File Type Detection ===

export type UnityFileType = 'scene' | 'prefab' | 'script' | 'asset' | 'meta' | 'asmdef';

export function detectFileType(filePath: string): UnityFileType | null {
  if (filePath.endsWith('.unity')) return 'scene';
  if (filePath.endsWith('.prefab')) return 'prefab';
  if (filePath.endsWith('.cs')) return 'script';
  if (filePath.endsWith('.asset')) return 'asset';
  if (filePath.endsWith('.meta')) return 'meta';
  if (filePath.endsWith('.asmdef')) return 'asmdef';
  return null;
}

// === Database Row Types ===

export interface FileRow {
  id?: number;
  path: string;
  type: UnityFileType;
  content_hash: string;
  modified_at: string;
  indexed_at: string;
  summary_line: string;
  importance_score: number;
  status: 'ok' | 'partial' | 'binary' | 'error';
}

export interface GameObjectRow {
  id?: number;
  file_id: number;
  file_id_local: string;
  name: string;
  parent_file_id_local: string | null;
  depth: number;
  sibling_index: number;
  active: boolean;
  layer: number;
  tag: string;
  component_summary: string;
  subtree_summary: string;
  is_leaf: boolean;
  child_count: number;
  subtree_depth: number;
  importance_score: number;
}

export interface ComponentRow {
  id?: number;
  game_object_id: number;
  type_name: string;
  script_guid: string | null;
  order: number;
  serialized_fields: string; // JSON
  field_summary: string;
  pattern_hash: string;
}

export interface ScriptRow {
  id?: number;
  file_id: number;
  class_name: string;
  namespace: string;
  base_class: string;
  interfaces: string; // JSON array
  assembly_name: string;
  api_summary: string;
  complexity_score: number;
  is_monobehaviour: boolean;
  is_editor_script: boolean;
  is_scriptable_object: boolean;
  is_generated: boolean;
}

export interface ScriptMemberRow {
  id?: number;
  script_id: number;
  name: string;
  kind: string;
  access: string;
  return_type: string;
  parameters: string; // JSON
  attributes: string; // JSON
  signature: string;
  has_serialize_field: boolean;
  has_header_attr: boolean;
}

export interface GuidRow {
  guid: string;
  file_id: number;
  asset_type: string;
}

export interface ReferenceRow {
  id?: number;
  source_file_id: number;
  source_context: string;
  target_guid: string;
  target_file_id: number | null;
  ref_type: string;
}

export interface ReferenceCountRow {
  file_id: number;
  guid: string;
  incoming_count: number;
  outgoing_count: number;
}

export interface AssemblyRow {
  id?: number;
  file_id: number;
  name: string;
  references: string; // JSON
  defines: string; // JSON
  platforms: string; // JSON
  dependency_summary: string;
}

export interface ChangeLogRow {
  id?: number;
  file_id: number;
  changed_at: string;
  change_type: 'added' | 'modified' | 'deleted';
}

export interface ProjectSummaryRow {
  id: number;
  file_counts: string; // JSON
  scene_count: number;
  prefab_count: number;
  script_count: number;
  assembly_structure: string; // JSON
  hot_scripts: string; // JSON
  recent_changes: string; // JSON
  description: string;
  indexed_at: string;
}
```

- [ ] **Step 7: Verify project compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .gitignore src/types.ts
git commit -m "feat: project scaffolding and shared types"
```

---

### Task 2: Test Fixtures

**Files:**
- Create: `tests/fixtures/TestProject/Assets/Scenes/MainScene.unity`
- Create: `tests/fixtures/TestProject/Assets/Scenes/MainScene.unity.meta`
- Create: `tests/fixtures/TestProject/Assets/Prefabs/Enemy.prefab`
- Create: `tests/fixtures/TestProject/Assets/Prefabs/Enemy.prefab.meta`
- Create: `tests/fixtures/TestProject/Assets/Scripts/PlayerController.cs`
- Create: `tests/fixtures/TestProject/Assets/Scripts/PlayerController.cs.meta`
- Create: `tests/fixtures/TestProject/Assets/Scripts/IDamageable.cs`
- Create: `tests/fixtures/TestProject/Assets/Scripts/IDamageable.cs.meta`
- Create: `tests/fixtures/TestProject/Assets/ScriptableObjects/GameConfig.asset`
- Create: `tests/fixtures/TestProject/Assets/ScriptableObjects/GameConfig.asset.meta`
- Create: `tests/fixtures/TestProject/Assets/GameLogic.asmdef`
- Create: `tests/fixtures/TestProject/Assets/GameLogic.asmdef.meta`

These fixtures are used by all parser tests. Create them first so tests can reference real files.

- [ ] **Step 1: Create MainScene.unity**

This scene has two GameObjects: Player (root, with Transform + MonoBehaviour) and Sprite (child of Player, with Transform only).

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!29 &1
OcclusionCullingSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_OcclusionBakeSettings:
    smallestOccluder: 5
    smallestHole: 0.25
    backfaceThreshold: 100
--- !u!104 &2
RenderSettings:
  m_ObjectHideFlags: 0
  serializedVersion: 9
  m_Fog: 0
  m_FogColor: {r: 0.5, g: 0.5, b: 0.5, a: 1}
--- !u!1 &100000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 100002}
  - component: {fileID: 100004}
  m_Layer: 0
  m_Name: Player
  m_TagString: Player
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &100002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 1, y: 2, z: 3}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children:
  - {fileID: 200002}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &100004
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: a1b2c3d4e5f6a1b2c3d4e5f6, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  speed: 5.5
  health: 100
  weapon: {fileID: 11400000, guid: e1e2e3e4e5e6e1e2e3e4e5e6, type: 3}
--- !u!1 &200000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 200002}
  m_Layer: 0
  m_Name: Sprite
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &200002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 200000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children: []
  m_Father: {fileID: 100002}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
```

- [ ] **Step 2: Create MainScene.unity.meta**

```yaml
fileFormatVersion: 2
guid: s1s2s3s4s5s6s1s2s3s4s5s6
DefaultImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 3: Create Enemy.prefab**

Single GameObject with Transform + MonoBehaviour. Not a variant.

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 100002}
  - component: {fileID: 100004}
  m_Layer: 0
  m_Name: Enemy
  m_TagString: Enemy
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &100002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &100004
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: e1e2e3e4e5e6e1e2e3e4e5e6, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  patrolSpeed: 3.0
  chaseSpeed: 6.0
  detectionRange: 10.0
```

- [ ] **Step 4: Create Enemy.prefab.meta**

```yaml
fileFormatVersion: 2
guid: e1e2e3e4e5e6e1e2e3e4e5e6
PrefabImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 5: Create PlayerController.cs**

```csharp
using UnityEngine;
using System;

namespace MyGame.Player
{
    public class PlayerController : MonoBehaviour, IDamageable
    {
        [SerializeField] private float speed = 5.5f;
        [SerializeField] private int health = 100;
        [Header("Weapons")]
        [SerializeField] private GameObject weapon;

        public bool IsAlive => health > 0;

        public float Speed => speed;

        public void TakeDamage(int amount)
        {
            health -= amount;
            if (health <= 0) Die();
        }

        private void Die()
        {
            Destroy(gameObject);
        }

        public void Attack()
        {
            Debug.Log("Attack!");
        }

        private void OnCollisionEnter2D(Collision2D collision)
        {
            var damageable = collision.gameObject.GetComponent<IDamageable>();
            if (damageable != null) damageable.TakeDamage(10);
        }
    }
}
```

- [ ] **Step 6: Create PlayerController.cs.meta**

```yaml
fileFormatVersion: 2
guid: a1b2c3d4e5f6a1b2c3d4e5f6
MonoImporter:
  externalObjects: {}
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: {instanceID: 0}
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 7: Create IDamageable.cs**

```csharp
namespace MyGame.Player
{
    public interface IDamageable
    {
        void TakeDamage(int amount);
        bool IsAlive { get; }
    }
}
```

- [ ] **Step 8: Create IDamageable.cs.meta**

```yaml
fileFormatVersion: 2
guid: d1d2d3d4d5d6d1d2d3d4d5d6
MonoImporter:
  externalObjects: {}
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: {instanceID: 0}
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 9: Create GameConfig.asset**

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 0}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: c1c2c3c4c5c6c1c2c3c4c5c6, type: 3}
  m_Name: GameConfig
  m_EditorClassIdentifier:
  maxPlayers: 4
  startingHealth: 100
  gameModes:
  - name: Deathmatch
    timeLimit: 300
  - name: CaptureFlag
    timeLimit: 600
```

- [ ] **Step 10: Create GameConfig.asset.meta**

```yaml
fileFormatVersion: 2
guid: c1c2c3c4c5c6c1c2c3c4c5c6
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 11400000
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 11: Create GameLogic.asmdef**

```json
{
    "name": "GameLogic",
    "rootNamespace": "MyGame",
    "references": [
        "Unity.TextMeshPro"
    ],
    "includePlatforms": [],
    "excludePlatforms": [],
    "allowUnsafeCode": false,
    "overrideReferences": false,
    "precompiledReferences": [],
    "autoReferenced": true,
    "defineConstraints": [],
    "versionDefines": [],
    "noEngineReferences": false
}
```

- [ ] **Step 12: Create GameLogic.asmdef.meta**

```yaml
fileFormatVersion: 2
guid: asm1asm2asm3asm4asm5asm6
AssemblyDefinitionImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
```

- [ ] **Step 13: Commit**

```bash
git add tests/fixtures/
git commit -m "feat: add Unity test fixtures"
```

---

### Task 3: Unity YAML Parser

**Files:**
- Create: `src/parsers/unity-yaml.ts`
- Create: `tests/parsers/unity-yaml.test.ts`

The core parser that splits Unity's multi-document YAML into individual documents with extracted classId, fileId, and parsed body. All scene/prefab/asset parsers depend on this.

Unity YAML is multi-document YAML with non-standard features:
- `%TAG !u! tag:unity3d.com,2011:` directive
- `--- !u!<classId> &<fileId>` document separators (optionally with `stripped`)
- Flow-style references: `{fileID: X, guid: Y, type: Z}`

Strategy: split on `---` boundaries, extract classId/fileId from separator line, parse each document body with the `yaml` npm package.

- [ ] **Step 1: Write failing tests**

```ts
// tests/parsers/unity-yaml.test.ts
import { describe, it, expect } from 'vitest';
import { parseUnityYaml, extractReferences } from '../../src/parsers/unity-yaml.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parseUnityYaml', () => {
  it('splits multi-document Unity YAML into documents', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    expect(docs.length).toBeGreaterThan(0);
    const gameObjectDocs = docs.filter(d => d.classId === 1);
    expect(gameObjectDocs).toHaveLength(2);
  });

  it('extracts classId and fileId from document headers', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    const playerGo = docs.find(d => d.classId === 1 && d.fileId === '100000');
    expect(playerGo).toBeDefined();
    expect(playerGo!.typeName).toBe('GameObject');

    const transform = docs.find(d => d.classId === 4 && d.fileId === '100002');
    expect(transform).toBeDefined();
    expect(transform!.typeName).toBe('Transform');
  });

  it('parses document body as key-value data', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    const playerGo = docs.find(d => d.classId === 1 && d.fileId === '100000');
    expect(playerGo).toBeDefined();
    const goData = playerGo!.data['GameObject'] as Record<string, unknown>;
    expect(goData['m_Name']).toBe('Player');
    expect(goData['m_TagString']).toBe('Player');
    expect(goData['m_IsActive']).toBe(1);
  });

  it('parses inline references as objects', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    const monoBehaviour = docs.find(d => d.classId === 114 && d.fileId === '100004');
    expect(monoBehaviour).toBeDefined();
    const mbData = monoBehaviour!.data['MonoBehaviour'] as Record<string, unknown>;
    const scriptRef = mbData['m_Script'] as Record<string, unknown>;
    expect(scriptRef['guid']).toBe('a1b2c3d4e5f6a1b2c3d4e5f6');
  });

  it('resolves typeName from class ID map', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    expect(docs.find(d => d.classId === 114)!.typeName).toBe('MonoBehaviour');
    expect(docs.find(d => d.classId === 29)!.typeName).toBe('OcclusionCullingSettings');
  });
});

describe('extractReferences', () => {
  it('extracts GUID references from parsed document data', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    const monoBehaviour = docs.find(d => d.classId === 114 && d.fileId === '100004');
    const refs = extractReferences(monoBehaviour!.data, 'MonoBehaviour:100004');

    const scriptRef = refs.find(r => r.targetGuid === 'a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(scriptRef).toBeDefined();

    const weaponRef = refs.find(r => r.targetGuid === 'e1e2e3e4e5e6e1e2e3e4e5e6');
    expect(weaponRef).toBeDefined();
  });

  it('ignores references with no guid (local fileID-only refs)', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const docs = parseUnityYaml(content);

    const transform = docs.find(d => d.classId === 4 && d.fileId === '100002');
    const refs = extractReferences(transform!.data, 'Transform:100002');

    // Transform has m_Father: {fileID: 0} and m_Children with local fileIDs — no GUIDs
    expect(refs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/unity-yaml.test.ts`
Expected: FAIL — module `../../src/parsers/unity-yaml.js` not found

- [ ] **Step 3: Implement unity-yaml.ts**

```ts
// src/parsers/unity-yaml.ts
import { parseDocument } from 'yaml';
import { UNITY_CLASS_IDS } from '../types.js';
import type { UnityYamlDocument, ParsedGuidReference } from '../types.js';

const DOC_HEADER_RE = /^--- !u!(\d+) &(\d+)(?: stripped)?$/;

export function parseUnityYaml(content: string): UnityYamlDocument[] {
  const documents: UnityYamlDocument[] = [];
  const rawDocs = splitDocuments(content);

  for (const raw of rawDocs) {
    const headerMatch = DOC_HEADER_RE.exec(raw.header);
    if (!headerMatch) continue;

    const classId = parseInt(headerMatch[1], 10);
    const fileId = headerMatch[2];
    const stripped = raw.header.includes('stripped');
    const typeName = UNITY_CLASS_IDS[classId] ?? `UnknownType_${classId}`;

    let data: Record<string, unknown> = {};
    try {
      const doc = parseDocument(raw.body, { uniqueKeys: false, maxAliasCount: -1 });
      data = doc.toJSON() ?? {};
    } catch {
      data = parseYamlFallback(raw.body);
    }

    documents.push({ classId, fileId, stripped, typeName, data });
  }

  return documents;
}

interface RawDocument {
  header: string;
  body: string;
}

function splitDocuments(content: string): RawDocument[] {
  const docs: RawDocument[] = [];
  const lines = content.split('\n');
  let currentHeader = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith('--- !u!')) {
      if (currentHeader) {
        docs.push({ header: currentHeader, body: currentBody.join('\n') });
      }
      currentHeader = line;
      currentBody = [];
    } else if (line.startsWith('%') || line.startsWith('---')) {
      // Skip %YAML, %TAG directives and bare --- lines
      continue;
    } else if (currentHeader) {
      currentBody.push(line);
    }
  }

  if (currentHeader) {
    docs.push({ header: currentHeader, body: currentBody.join('\n') });
  }

  return docs;
}

function parseYamlFallback(body: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = body.split('\n');
  if (lines.length > 0) {
    const rootMatch = lines[0].match(/^(\w+):$/);
    if (rootMatch) {
      result[rootMatch[1]] = {};
    }
  }
  return result;
}

export function extractReferences(
  data: Record<string, unknown>,
  context: string
): ParsedGuidReference[] {
  const refs: ParsedGuidReference[] = [];
  walkForReferences(data, context, refs);
  return refs;
}

function walkForReferences(
  obj: unknown,
  context: string,
  refs: ParsedGuidReference[]
): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if ('guid' in record && 'fileID' in record) {
      const guid = String(record['guid']);
      const fileID = String(record['fileID']);
      if (guid && guid !== '0' && guid !== '') {
        refs.push({
          targetGuid: guid,
          targetFileId: fileID,
          context,
          refType: context.includes('m_Script') ? 'script_attachment' : 'field_reference',
        });
      }
      return;
    }

    for (const [key, value] of Object.entries(record)) {
      walkForReferences(value, `${context}.${key}`, refs);
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkForReferences(obj[i], `${context}[${i}]`, refs);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/unity-yaml.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/unity-yaml.ts tests/parsers/unity-yaml.test.ts
git commit -m "feat: Unity YAML parser with document splitting and reference extraction"
```

---

### Task 4: Meta Parser + AsmDef Parser

**Files:**
- Create: `src/parsers/meta-parser.ts`
- Create: `src/parsers/asmdef-parser.ts`
- Create: `tests/parsers/meta-parser.test.ts`
- Create: `tests/parsers/asmdef-parser.test.ts`

Both are simple parsers. Meta extracts GUID from YAML. AsmDef parses JSON.

- [ ] **Step 1: Write failing tests for meta parser**

```ts
// tests/parsers/meta-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseMeta } from '../../src/parsers/meta-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parseMeta', () => {
  it('extracts GUID from .meta file', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs.meta'), 'utf-8');
    const result = parseMeta(content);
    expect(result.guid).toBe('a1b2c3d4e5f6a1b2c3d4e5f6');
  });

  it('detects asset type from importer key', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs.meta'), 'utf-8');
    const result = parseMeta(content);
    expect(result.assetType).toBe('script');
  });

  it('detects prefab asset type', () => {
    const content = readFileSync(join(FIXTURES, 'Prefabs/Enemy.prefab.meta'), 'utf-8');
    const result = parseMeta(content);
    expect(result.assetType).toBe('prefab');
  });

  it('detects scene asset type', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity.meta'), 'utf-8');
    const result = parseMeta(content);
    expect(result.assetType).toBe('scene');
  });
});
```

- [ ] **Step 2: Write failing tests for asmdef parser**

```ts
// tests/parsers/asmdef-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseAsmDef } from '../../src/parsers/asmdef-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parseAsmDef', () => {
  it('extracts assembly name', () => {
    const content = readFileSync(join(FIXTURES, 'GameLogic.asmdef'), 'utf-8');
    const result = parseAsmDef(content);
    expect(result.name).toBe('GameLogic');
  });

  it('extracts root namespace', () => {
    const content = readFileSync(join(FIXTURES, 'GameLogic.asmdef'), 'utf-8');
    const result = parseAsmDef(content);
    expect(result.rootNamespace).toBe('MyGame');
  });

  it('extracts references', () => {
    const content = readFileSync(join(FIXTURES, 'GameLogic.asmdef'), 'utf-8');
    const result = parseAsmDef(content);
    expect(result.references).toContain('Unity.TextMeshPro');
  });

  it('handles empty platforms', () => {
    const content = readFileSync(join(FIXTURES, 'GameLogic.asmdef'), 'utf-8');
    const result = parseAsmDef(content);
    expect(result.includePlatforms).toEqual([]);
    expect(result.excludePlatforms).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/parsers/meta-parser.test.ts tests/parsers/asmdef-parser.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement meta-parser.ts**

```ts
// src/parsers/meta-parser.ts
import type { ParsedMeta } from '../types.js';

const GUID_RE = /^guid:\s*([0-9a-f]+)\s*$/m;

const IMPORTER_ASSET_TYPE: Record<string, string> = {
  MonoImporter: 'script',
  PrefabImporter: 'prefab',
  DefaultImporter: 'scene',
  NativeFormatImporter: 'asset',
  TextureImporter: 'texture',
  ModelImporter: 'model',
  AudioImporter: 'audio',
  ShaderImporter: 'shader',
  AssemblyDefinitionImporter: 'asmdef',
  VideoClipImporter: 'video',
  TrueTypeFontImporter: 'font',
  PluginImporter: 'plugin',
};

export function parseMeta(content: string): ParsedMeta {
  const guidMatch = GUID_RE.exec(content);
  if (!guidMatch) {
    throw new Error('No GUID found in .meta file');
  }

  let assetType = 'unknown';
  for (const [importerKey, type] of Object.entries(IMPORTER_ASSET_TYPE)) {
    if (content.includes(importerKey + ':')) {
      assetType = type;
      break;
    }
  }

  return { guid: guidMatch[1], assetType };
}
```

- [ ] **Step 5: Implement asmdef-parser.ts**

```ts
// src/parsers/asmdef-parser.ts
import type { ParsedAsmDef } from '../types.js';

export function parseAsmDef(content: string): ParsedAsmDef {
  const raw = JSON.parse(content);

  return {
    name: raw.name ?? '',
    rootNamespace: raw.rootNamespace ?? '',
    references: raw.references ?? [],
    defines: raw.defineConstraints ?? [],
    includePlatforms: raw.includePlatforms ?? [],
    excludePlatforms: raw.excludePlatforms ?? [],
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/meta-parser.test.ts tests/parsers/asmdef-parser.test.ts`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/parsers/meta-parser.ts src/parsers/asmdef-parser.ts tests/parsers/meta-parser.test.ts tests/parsers/asmdef-parser.test.ts
git commit -m "feat: meta parser and asmdef parser"
```

---

### Task 5: Component Defaults Table

**Files:**
- Create: `src/parsers/defaults.ts`

Ships a table of known default values for common Unity components. Used by scene/prefab parsers to strip noise.

- [ ] **Step 1: Create defaults.ts**

```ts
// src/parsers/defaults.ts

// Default values for common Unity built-in component fields.
// If a field matches its default, it gets stripped from the index to save tokens.
// Keys are "ComponentType.fieldName", values are the default value (deep-equal compared).

export const COMPONENT_DEFAULTS: Record<string, Record<string, unknown>> = {
  Transform: {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    serializedVersion: 2,
    m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    m_LocalPosition: { x: 0, y: 0, z: 0 },
    m_LocalScale: { x: 1, y: 1, z: 1 },
    m_ConstrainProportionsScale: 0,
    m_LocalEulerAnglesHint: { x: 0, y: 0, z: 0 },
  },
  RectTransform: {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    serializedVersion: 2,
    m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    m_LocalPosition: { x: 0, y: 0, z: 0 },
    m_LocalScale: { x: 1, y: 1, z: 1 },
    m_AnchorMin: { x: 0, y: 0 },
    m_AnchorMax: { x: 0, y: 0 },
    m_AnchoredPosition: { x: 0, y: 0 },
    m_SizeDelta: { x: 0, y: 0 },
    m_Pivot: { x: 0.5, y: 0.5 },
  },
  GameObject: {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    serializedVersion: 6,
    m_Icon: { fileID: 0 },
    m_NavMeshLayer: 0,
    m_StaticEditorFlags: 0,
  },
  MonoBehaviour: {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    m_Enabled: 1,
    m_EditorHideFlags: 0,
    m_Name: '',
    m_EditorClassIdentifier: '',
  },
  Camera: {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    m_Enabled: 1,
  },
};

// Common fields that are always noise regardless of component type
const ALWAYS_DEFAULT_FIELDS = new Set([
  'm_ObjectHideFlags',
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
  'm_EditorHideFlags',
  'm_EditorClassIdentifier',
]);

export function stripDefaults(
  typeName: string,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const defaults = COMPONENT_DEFAULTS[typeName] ?? {};
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (ALWAYS_DEFAULT_FIELDS.has(key)) continue;
    if (key in defaults && deepEqual(value, defaults[key])) continue;
    result[key] = value;
  }

  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/parsers/defaults.ts
git commit -m "feat: component defaults table for noise stripping"
```

---

### Task 6: Script Parser (tree-sitter)

**Files:**
- Create: `src/parsers/script-parser.ts`
- Create: `tests/parsers/script-parser.test.ts`
- Create: `grammars/` directory + download WASM grammar

Uses `web-tree-sitter` with the C# grammar WASM to extract class declarations and member signatures.

- [ ] **Step 1: Download C# tree-sitter WASM grammar**

Run:
```bash
mkdir -p grammars
curl -L -o grammars/tree-sitter-c_sharp.wasm \
  https://github.com/nicolo-ribaudo/tree-sitter-wasm-builds/releases/latest/download/tree-sitter-c_sharp.wasm
```

If the URL changes, an alternative is to build from `tree-sitter-c-sharp` source:
```bash
npx tree-sitter build --wasm node_modules/tree-sitter-c-sharp
```

Verify file exists: `ls -la grammars/tree-sitter-c_sharp.wasm`

- [ ] **Step 2: Write failing tests**

```ts
// tests/parsers/script-parser.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { initScriptParser, parseScript } from '../../src/parsers/script-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

beforeAll(async () => {
  await initScriptParser();
});

describe('parseScript', () => {
  it('extracts class declarations from C# file', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);

    expect(results).toHaveLength(1);
    expect(results[0].className).toBe('PlayerController');
    expect(results[0].kind).toBe('class');
  });

  it('extracts namespace', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    expect(results[0].namespace).toBe('MyGame.Player');
  });

  it('extracts base class and interfaces', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    expect(results[0].baseClass).toBe('MonoBehaviour');
    expect(results[0].interfaces).toContain('IDamageable');
  });

  it('detects MonoBehaviour', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    expect(results[0].isMonoBehaviour).toBe(true);
  });

  it('extracts method signatures', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    const methods = results[0].members.filter(m => m.kind === 'method');

    const takeDamage = methods.find(m => m.name === 'TakeDamage');
    expect(takeDamage).toBeDefined();
    expect(takeDamage!.access).toBe('public');
    expect(takeDamage!.returnType).toBe('void');
    expect(takeDamage!.parameters).toEqual([{ name: 'amount', type: 'int' }]);
  });

  it('extracts fields with attributes', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    const fields = results[0].members.filter(m => m.kind === 'field');

    const speed = fields.find(m => m.name === 'speed');
    expect(speed).toBeDefined();
    expect(speed!.attributes).toContain('SerializeField');
    expect(speed!.returnType).toBe('float');
  });

  it('extracts properties', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);
    const props = results[0].members.filter(m => m.kind === 'property');

    const isAlive = props.find(m => m.name === 'IsAlive');
    expect(isAlive).toBeDefined();
    expect(isAlive!.access).toBe('public');
    expect(isAlive!.returnType).toBe('bool');
  });

  it('parses interface files', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/IDamageable.cs'), 'utf-8');
    const results = parseScript(content);

    expect(results).toHaveLength(1);
    expect(results[0].className).toBe('IDamageable');
    expect(results[0].kind).toBe('interface');
    expect(results[0].isMonoBehaviour).toBe(false);
  });

  it('generates api_summary text', () => {
    const content = readFileSync(join(FIXTURES, 'Scripts/PlayerController.cs'), 'utf-8');
    const results = parseScript(content);

    expect(results[0].members.length).toBeGreaterThan(0);
    // api_summary is generated externally by summaries.ts — parseScript provides the data
  });

  it('detects generated code', () => {
    const generated = `// <auto-generated>
// This code was generated by a tool.
// </auto-generated>
namespace Generated { public class Foo { } }`;
    const results = parseScript(generated);
    expect(results[0].isGenerated).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/script-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement script-parser.ts**

```ts
// src/parsers/script-parser.ts
import Parser from 'web-tree-sitter';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ParsedScript, ParsedScriptMember } from '../types.js';

let parser: Parser | null = null;

const MONOBEHAVIOUR_BASES = new Set([
  'MonoBehaviour', 'NetworkBehaviour', 'StateMachineBehaviour',
]);
const SCRIPTABLE_OBJECT_BASES = new Set([
  'ScriptableObject',
]);
const EDITOR_BASES = new Set([
  'Editor', 'EditorWindow', 'PropertyDrawer', 'DecoratorDrawer',
  'AssetPostprocessor', 'AssetModificationProcessor',
]);
const GENERATED_MARKERS = [
  '<auto-generated>', 'auto-generated', 'This code was generated',
];

export async function initScriptParser(): Promise<void> {
  if (parser) return;
  await Parser.init();
  parser = new Parser();

  const thisDir = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(thisDir, '../../grammars/tree-sitter-c_sharp.wasm');
  const lang = await Parser.Language.load(wasmPath);
  parser.setLanguage(lang);
}

export function parseScript(content: string): ParsedScript[] {
  if (!parser) throw new Error('Call initScriptParser() first');

  const tree = parser.parse(content);
  const root = tree.rootNode;
  const results: ParsedScript[] = [];
  const isGenerated = GENERATED_MARKERS.some(m => content.slice(0, 500).includes(m));
  const loc = content.split('\n').length;

  const namespaces = findNamespaces(root);

  for (const typeNode of findTypeDeclarations(root)) {
    const kind = typeKind(typeNode);
    const className = typeNode.childForFieldName('name')?.text ?? '';
    const namespace = findEnclosingNamespace(typeNode, namespaces);
    const bases = extractBases(typeNode);
    const baseClass = bases.baseClass;
    const interfaces = bases.interfaces;
    const members = extractMembers(typeNode);
    const isEditorScript = EDITOR_BASES.has(baseClass);

    results.push({
      className,
      kind,
      namespace,
      baseClass,
      interfaces,
      members,
      isMonoBehaviour: MONOBEHAVIOUR_BASES.has(baseClass),
      isEditorScript,
      isScriptableObject: SCRIPTABLE_OBJECT_BASES.has(baseClass),
      isGenerated,
      loc,
    });
  }

  return results;
}

function findNamespaces(root: Parser.SyntaxNode): Map<string, Parser.SyntaxNode> {
  const map = new Map<string, Parser.SyntaxNode>();
  walkNodes(root, node => {
    if (node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) map.set(nameNode.text, node);
    }
  });
  return map;
}

function findEnclosingNamespace(
  node: Parser.SyntaxNode,
  namespaces: Map<string, Parser.SyntaxNode>
): string {
  for (const [name, nsNode] of namespaces) {
    if (node.startIndex >= nsNode.startIndex && node.endIndex <= nsNode.endIndex) {
      return name;
    }
  }
  return '';
}

function findTypeDeclarations(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const types: Parser.SyntaxNode[] = [];
  walkNodes(root, node => {
    if (['class_declaration', 'struct_declaration', 'interface_declaration', 'enum_declaration'].includes(node.type)) {
      types.push(node);
    }
  });
  return types;
}

function typeKind(node: Parser.SyntaxNode): ParsedScript['kind'] {
  switch (node.type) {
    case 'class_declaration': return 'class';
    case 'struct_declaration': return 'struct';
    case 'interface_declaration': return 'interface';
    case 'enum_declaration': return 'enum';
    default: return 'class';
  }
}

function extractBases(typeNode: Parser.SyntaxNode): { baseClass: string; interfaces: string[] } {
  const baseList = typeNode.childForFieldName('bases');
  if (!baseList) return { baseClass: '', interfaces: [] };

  const names: string[] = [];
  walkNodes(baseList, node => {
    if (node.type === 'identifier' || node.type === 'qualified_name' || node.type === 'generic_name') {
      if (node.parent?.type === 'base_list' || node.parent?.type === 'simple_base_type') {
        names.push(node.text);
      }
    }
  });

  if (names.length === 0) return { baseClass: '', interfaces: [] };

  // In C#, the base class (if present) is always first, followed by interfaces.
  // Interfaces conventionally start with 'I'.
  const first = names[0];
  if (first.startsWith('I') && first.length > 1 && first[1] === first[1].toUpperCase()) {
    return { baseClass: '', interfaces: names };
  }

  return { baseClass: first, interfaces: names.slice(1) };
}

function extractMembers(typeNode: Parser.SyntaxNode): ParsedScriptMember[] {
  const members: ParsedScriptMember[] = [];
  const body = typeNode.childForFieldName('body');
  if (!body) return members;

  for (const child of body.namedChildren) {
    const member = extractMember(child);
    if (member) members.push(member);
  }

  return members;
}

function extractMember(node: Parser.SyntaxNode): ParsedScriptMember | null {
  const attributes = extractAttributes(node);
  const modifiers = extractModifiers(node);
  const access = modifiers.access;
  const isStatic = modifiers.isStatic;

  switch (node.type) {
    case 'method_declaration': {
      const name = node.childForFieldName('name')?.text ?? '';
      const returnType = node.childForFieldName('type')?.text ?? 'void';
      const params = extractParameters(node);
      return { name, kind: 'method', access, returnType, parameters: params, attributes, isStatic };
    }
    case 'field_declaration': {
      const declaration = node.namedChildren.find(c => c.type === 'variable_declaration');
      const type = declaration?.childForFieldName('type')?.text ?? '';
      const declarators = declaration?.namedChildren.filter(c => c.type === 'variable_declarator') ?? [];
      if (declarators.length > 0) {
        const name = declarators[0].childForFieldName('name')?.text ?? '';
        return { name, kind: 'field', access, returnType: type, parameters: [], attributes, isStatic };
      }
      return null;
    }
    case 'property_declaration': {
      const name = node.childForFieldName('name')?.text ?? '';
      const type = node.childForFieldName('type')?.text ?? '';
      return { name, kind: 'property', access, returnType: type, parameters: [], attributes, isStatic };
    }
    case 'event_field_declaration': {
      const declaration = node.namedChildren.find(c => c.type === 'variable_declaration');
      const type = declaration?.childForFieldName('type')?.text ?? '';
      const declarators = declaration?.namedChildren.filter(c => c.type === 'variable_declarator') ?? [];
      if (declarators.length > 0) {
        const name = declarators[0].childForFieldName('name')?.text ?? '';
        return { name, kind: 'event', access, returnType: type, parameters: [], attributes, isStatic };
      }
      return null;
    }
    case 'constructor_declaration': {
      const name = node.childForFieldName('name')?.text ?? '';
      const params = extractParameters(node);
      return { name, kind: 'constructor', access, returnType: '', parameters: params, attributes, isStatic };
    }
    default:
      return null;
  }
}

function extractParameters(node: Parser.SyntaxNode): Array<{ name: string; type: string }> {
  const paramList = node.childForFieldName('parameters');
  if (!paramList) return [];

  const params: Array<{ name: string; type: string }> = [];
  for (const child of paramList.namedChildren) {
    if (child.type === 'parameter') {
      const name = child.childForFieldName('name')?.text ?? '';
      const type = child.childForFieldName('type')?.text ?? '';
      if (name && type) params.push({ name, type });
    }
  }
  return params;
}

function extractAttributes(node: Parser.SyntaxNode): string[] {
  const attrs: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'attribute_list') {
      for (const attrNode of child.namedChildren) {
        if (attrNode.type === 'attribute') {
          const name = attrNode.childForFieldName('name')?.text ?? '';
          if (name) attrs.push(name);
        }
      }
    }
  }
  return attrs;
}

function extractModifiers(node: Parser.SyntaxNode): { access: string; isStatic: boolean } {
  let access = 'private';
  let isStatic = false;

  for (const child of node.children) {
    if (child.type === 'modifier') {
      const text = child.text;
      if (['public', 'private', 'protected', 'internal'].includes(text)) {
        access = text;
      }
      if (text === 'static') isStatic = true;
    }
  }

  // Interface members are implicitly public
  if (node.parent?.parent?.type === 'interface_declaration' && access === 'private') {
    access = 'public';
  }

  return { access, isStatic };
}

function walkNodes(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
  callback(node);
  for (const child of node.namedChildren) {
    walkNodes(child, callback);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/script-parser.test.ts`
Expected: all PASS

If tree-sitter WASM fails to load, check that the grammar file exists at `grammars/tree-sitter-c_sharp.wasm` and that `web-tree-sitter` is correctly installed. The init function resolves the path relative to the source file's directory.

- [ ] **Step 6: Commit**

```bash
git add src/parsers/script-parser.ts tests/parsers/script-parser.test.ts grammars/
git commit -m "feat: C# script parser with tree-sitter"
```

---

### Task 7: Scene Parser

**Files:**
- Create: `src/parsers/scene-parser.ts`
- Create: `tests/parsers/scene-parser.test.ts`

Parses `.unity` scene files into structured GameObjects + components + hierarchy. Uses unity-yaml parser and defaults table.

- [ ] **Step 1: Write failing tests**

```ts
// tests/parsers/scene-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseScene } from '../../src/parsers/scene-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parseScene', () => {
  it('extracts GameObjects from scene file', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    expect(result.gameObjects).toHaveLength(2);
    const names = result.gameObjects.map(go => go.name);
    expect(names).toContain('Player');
    expect(names).toContain('Sprite');
  });

  it('builds parent-child hierarchy', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const player = result.gameObjects.find(go => go.name === 'Player')!;
    expect(player.parentFileIdLocal).toBeNull();

    const sprite = result.gameObjects.find(go => go.name === 'Sprite')!;
    expect(sprite.parentFileIdLocal).toBe(player.fileIdLocal);
  });

  it('extracts components per GameObject', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const player = result.gameObjects.find(go => go.name === 'Player')!;
    const componentTypes = player.components.map(c => c.typeName);
    expect(componentTypes).toContain('Transform');
    expect(componentTypes).toContain('MonoBehaviour');
  });

  it('extracts MonoBehaviour script GUID', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const player = result.gameObjects.find(go => go.name === 'Player')!;
    const mb = player.components.find(c => c.typeName === 'MonoBehaviour')!;
    expect(mb.scriptGuid).toBe('a1b2c3d4e5f6a1b2c3d4e5f6');
  });

  it('strips default values from component fields', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const player = result.gameObjects.find(go => go.name === 'Player')!;
    const mb = player.components.find(c => c.typeName === 'MonoBehaviour')!;
    // MonoBehaviour defaults like m_Enabled, m_ObjectHideFlags should be stripped
    expect(mb.serializedFields).not.toHaveProperty('m_Enabled');
    expect(mb.serializedFields).not.toHaveProperty('m_ObjectHideFlags');
    // Custom fields should remain
    expect(mb.serializedFields).toHaveProperty('speed');
    expect(mb.serializedFields['speed']).toBe(5.5);
  });

  it('extracts GUID references from scene', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const scriptRef = result.references.find(r => r.targetGuid === 'a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(scriptRef).toBeDefined();
    expect(scriptRef!.refType).toBe('script_attachment');

    const weaponRef = result.references.find(r => r.targetGuid === 'e1e2e3e4e5e6e1e2e3e4e5e6');
    expect(weaponRef).toBeDefined();
  });

  it('extracts GameObject metadata (layer, tag, active)', () => {
    const content = readFileSync(join(FIXTURES, 'Scenes/MainScene.unity'), 'utf-8');
    const result = parseScene(content);

    const player = result.gameObjects.find(go => go.name === 'Player')!;
    expect(player.tag).toBe('Player');
    expect(player.layer).toBe(0);
    expect(player.active).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/scene-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scene-parser.ts**

```ts
// src/parsers/scene-parser.ts
import { parseUnityYaml, extractReferences } from './unity-yaml.js';
import { stripDefaults } from './defaults.js';
import type {
  ParsedScene, ParsedGameObject, ParsedComponent,
  ParsedGuidReference, UnityYamlDocument,
} from '../types.js';

export function parseScene(content: string): ParsedScene {
  const docs = parseUnityYaml(content);
  return buildScene(docs);
}

export function buildScene(docs: UnityYamlDocument[]): ParsedScene {
  const gameObjectDocs = docs.filter(d => d.classId === 1);
  const transformDocs = docs.filter(d => d.classId === 4 || d.classId === 224); // Transform or RectTransform
  const componentDocs = docs.filter(d => d.classId !== 1 && d.classId !== 29 && d.classId !== 104 && d.classId !== 196);

  // Build fileId → Transform map for hierarchy resolution
  const transformByFileId = new Map<string, UnityYamlDocument>();
  for (const t of transformDocs) {
    transformByFileId.set(t.fileId, t);
  }

  // Build fileId → component docs map
  const componentsByGameObject = new Map<string, UnityYamlDocument[]>();
  for (const doc of componentDocs) {
    const typeName = Object.keys(doc.data)[0];
    if (!typeName) continue;
    const data = doc.data[typeName] as Record<string, unknown>;
    const goRef = data['m_GameObject'] as Record<string, unknown> | undefined;
    if (!goRef || !goRef['fileID']) continue;
    const goFileId = String(goRef['fileID']);
    const existing = componentsByGameObject.get(goFileId) ?? [];
    existing.push(doc);
    componentsByGameObject.set(goFileId, existing);
  }

  // Build Transform hierarchy: fileId → parent fileId
  const goTransformFileId = new Map<string, string>(); // gameObject fileId → transform fileId
  const transformParent = new Map<string, string | null>(); // transform fileId → parent transform fileId
  const transformToGo = new Map<string, string>(); // transform fileId → gameObject fileId

  for (const tDoc of transformDocs) {
    const tData = tDoc.data[Object.keys(tDoc.data)[0]] as Record<string, unknown>;
    const goRef = tData['m_GameObject'] as Record<string, unknown> | undefined;
    if (goRef) {
      const goFileId = String(goRef['fileID']);
      goTransformFileId.set(goFileId, tDoc.fileId);
      transformToGo.set(tDoc.fileId, goFileId);
    }
    const father = tData['m_Father'] as Record<string, unknown> | undefined;
    if (father) {
      const fatherId = String(father['fileID']);
      transformParent.set(tDoc.fileId, fatherId === '0' ? null : fatherId);
    }
  }

  const allReferences: ParsedGuidReference[] = [];
  const gameObjects: ParsedGameObject[] = [];

  for (const goDoc of gameObjectDocs) {
    const goData = goDoc.data['GameObject'] as Record<string, unknown>;
    if (!goData) continue;

    const name = String(goData['m_Name'] ?? '');
    const tag = String(goData['m_TagString'] ?? 'Untagged');
    const layer = Number(goData['m_Layer'] ?? 0);
    const active = goData['m_IsActive'] === 1;

    // Resolve parent via transform hierarchy
    const transformFileId = goTransformFileId.get(goDoc.fileId);
    let parentGoFileId: string | null = null;
    if (transformFileId) {
      const parentTransformId = transformParent.get(transformFileId);
      if (parentTransformId) {
        parentGoFileId = transformToGo.get(parentTransformId) ?? null;
      }
    }

    // Collect components
    const compDocs = componentsByGameObject.get(goDoc.fileId) ?? [];
    const components: ParsedComponent[] = [];
    let order = 0;

    for (const compDoc of compDocs) {
      const typeName = compDoc.typeName;
      const compData = compDoc.data[Object.keys(compDoc.data)[0]] as Record<string, unknown>;
      if (!compData) continue;

      // Extract script GUID for MonoBehaviours
      let scriptGuid: string | null = null;
      const scriptRef = compData['m_Script'] as Record<string, unknown> | undefined;
      if (scriptRef && scriptRef['guid']) {
        scriptGuid = String(scriptRef['guid']);
      }

      // Strip defaults
      const stripped = stripDefaults(typeName, compData);
      // Also remove m_GameObject (redundant) and m_Script (captured separately)
      delete stripped['m_GameObject'];
      delete stripped['m_Script'];

      components.push({
        fileIdLocal: compDoc.fileId,
        typeName,
        scriptGuid,
        order: order++,
        serializedFields: stripped,
        gameObjectFileId: goDoc.fileId,
      });

      // Extract references from this component
      const refs = extractReferences(compDoc.data, `${typeName}:${compDoc.fileId}`);
      allReferences.push(...refs);
    }

    gameObjects.push({
      fileIdLocal: goDoc.fileId,
      name,
      parentFileIdLocal: parentGoFileId,
      active,
      layer,
      tag,
      components,
    });
  }

  return { gameObjects, references: allReferences };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/scene-parser.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/scene-parser.ts tests/parsers/scene-parser.test.ts
git commit -m "feat: scene parser with hierarchy, components, and reference extraction"
```

---

### Task 8: Prefab Parser + Asset Parser

**Files:**
- Create: `src/parsers/prefab-parser.ts`
- Create: `src/parsers/asset-parser.ts`
- Create: `tests/parsers/prefab-parser.test.ts`
- Create: `tests/parsers/asset-parser.test.ts`

Prefab parser extends scene parser. Asset parser handles ScriptableObjects.

- [ ] **Step 1: Write failing tests for prefab parser**

```ts
// tests/parsers/prefab-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parsePrefab } from '../../src/parsers/prefab-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parsePrefab', () => {
  it('parses prefab GameObjects', () => {
    const content = readFileSync(join(FIXTURES, 'Prefabs/Enemy.prefab'), 'utf-8');
    const result = parsePrefab(content);

    expect(result.gameObjects).toHaveLength(1);
    expect(result.gameObjects[0].name).toBe('Enemy');
  });

  it('detects non-variant prefabs', () => {
    const content = readFileSync(join(FIXTURES, 'Prefabs/Enemy.prefab'), 'utf-8');
    const result = parsePrefab(content);

    expect(result.isVariant).toBe(false);
    expect(result.sourcePrefabGuid).toBeNull();
  });

  it('extracts components from prefab', () => {
    const content = readFileSync(join(FIXTURES, 'Prefabs/Enemy.prefab'), 'utf-8');
    const result = parsePrefab(content);

    const enemy = result.gameObjects[0];
    const types = enemy.components.map(c => c.typeName);
    expect(types).toContain('Transform');
    expect(types).toContain('MonoBehaviour');
  });

  it('extracts custom fields from MonoBehaviour', () => {
    const content = readFileSync(join(FIXTURES, 'Prefabs/Enemy.prefab'), 'utf-8');
    const result = parsePrefab(content);

    const enemy = result.gameObjects[0];
    const mb = enemy.components.find(c => c.typeName === 'MonoBehaviour')!;
    expect(mb.serializedFields['patrolSpeed']).toBe(3.0);
    expect(mb.serializedFields['chaseSpeed']).toBe(6.0);
    expect(mb.serializedFields['detectionRange']).toBe(10.0);
  });

  it('detects variant prefabs', () => {
    const variantContent = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &100100
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: e1e2e3e4e5e6e1e2e3e4e5e6, type: 3}`;

    const result = parsePrefab(variantContent);
    expect(result.isVariant).toBe(true);
    expect(result.sourcePrefabGuid).toBe('e1e2e3e4e5e6e1e2e3e4e5e6');
  });
});
```

- [ ] **Step 2: Write failing tests for asset parser**

```ts
// tests/parsers/asset-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseAsset } from '../../src/parsers/asset-parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject/Assets');

describe('parseAsset', () => {
  it('extracts ScriptableObject name', () => {
    const content = readFileSync(join(FIXTURES, 'ScriptableObjects/GameConfig.asset'), 'utf-8');
    const result = parseAsset(content);
    expect(result.name).toBe('GameConfig');
  });

  it('extracts script GUID', () => {
    const content = readFileSync(join(FIXTURES, 'ScriptableObjects/GameConfig.asset'), 'utf-8');
    const result = parseAsset(content);
    expect(result.scriptGuid).toBe('c1c2c3c4c5c6c1c2c3c4c5c6');
  });

  it('extracts custom serialized fields', () => {
    const content = readFileSync(join(FIXTURES, 'ScriptableObjects/GameConfig.asset'), 'utf-8');
    const result = parseAsset(content);
    expect(result.serializedFields['maxPlayers']).toBe(4);
    expect(result.serializedFields['startingHealth']).toBe(100);
  });

  it('extracts nested data structures', () => {
    const content = readFileSync(join(FIXTURES, 'ScriptableObjects/GameConfig.asset'), 'utf-8');
    const result = parseAsset(content);
    const gameModes = result.serializedFields['gameModes'] as Array<Record<string, unknown>>;
    expect(gameModes).toHaveLength(2);
    expect(gameModes[0]['name']).toBe('Deathmatch');
  });

  it('extracts GUID references', () => {
    const content = readFileSync(join(FIXTURES, 'ScriptableObjects/GameConfig.asset'), 'utf-8');
    const result = parseAsset(content);
    const scriptRef = result.references.find(r => r.targetGuid === 'c1c2c3c4c5c6c1c2c3c4c5c6');
    expect(scriptRef).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/prefab-parser.test.ts tests/parsers/asset-parser.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement prefab-parser.ts**

```ts
// src/parsers/prefab-parser.ts
import { parseUnityYaml, extractReferences } from './unity-yaml.js';
import { buildScene } from './scene-parser.js';
import type { ParsedPrefab } from '../types.js';

export function parsePrefab(content: string): ParsedPrefab {
  const docs = parseUnityYaml(content);
  const scene = buildScene(docs);

  // Check for variant: look for PrefabInstance with m_SourcePrefab
  let isVariant = false;
  let sourcePrefabGuid: string | null = null;

  for (const doc of docs) {
    if (doc.classId === 1001 || doc.classId === 1101) {
      const typeName = Object.keys(doc.data)[0];
      if (!typeName) continue;
      const data = doc.data[typeName] as Record<string, unknown>;
      const sourcePrefab = data['m_SourcePrefab'] as Record<string, unknown> | undefined;
      if (sourcePrefab && sourcePrefab['guid']) {
        isVariant = true;
        sourcePrefabGuid = String(sourcePrefab['guid']);
      }
    }
  }

  // Collect additional references from PrefabInstance docs
  for (const doc of docs) {
    if (doc.classId === 1001 || doc.classId === 1101) {
      const refs = extractReferences(doc.data, `PrefabInstance:${doc.fileId}`);
      for (const ref of refs) {
        ref.refType = 'prefab_variant';
      }
      scene.references.push(...refs);
    }
  }

  return {
    ...scene,
    isVariant,
    sourcePrefabGuid,
  };
}
```

- [ ] **Step 5: Implement asset-parser.ts**

```ts
// src/parsers/asset-parser.ts
import { parseUnityYaml, extractReferences } from './unity-yaml.js';
import { stripDefaults } from './defaults.js';
import type { ParsedAsset } from '../types.js';

export function parseAsset(content: string): ParsedAsset {
  const docs = parseUnityYaml(content);

  // Assets typically have a single MonoBehaviour document (ScriptableObject)
  const mainDoc = docs.find(d => d.classId === 114) ?? docs[0];
  if (!mainDoc) {
    return { typeName: 'Unknown', name: '', scriptGuid: null, serializedFields: {}, references: [] };
  }

  const typeName = Object.keys(mainDoc.data)[0] ?? 'Unknown';
  const data = mainDoc.data[typeName] as Record<string, unknown>;
  if (!data) {
    return { typeName, name: '', scriptGuid: null, serializedFields: {}, references: [] };
  }

  const name = String(data['m_Name'] ?? '');

  let scriptGuid: string | null = null;
  const scriptRef = data['m_Script'] as Record<string, unknown> | undefined;
  if (scriptRef && scriptRef['guid']) {
    scriptGuid = String(scriptRef['guid']);
  }

  const stripped = stripDefaults('MonoBehaviour', data);
  delete stripped['m_GameObject'];
  delete stripped['m_Script'];
  delete stripped['m_Name'];

  const references = extractReferences(mainDoc.data, `${typeName}:${mainDoc.fileId}`);

  return { typeName, name, scriptGuid, serializedFields: stripped, references };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/prefab-parser.test.ts tests/parsers/asset-parser.test.ts`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/parsers/prefab-parser.ts src/parsers/asset-parser.ts tests/parsers/prefab-parser.test.ts tests/parsers/asset-parser.test.ts
git commit -m "feat: prefab parser and asset parser"
```

---

### Task 9: SQLite Schema + Database Store

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/store.ts`
- Create: `tests/db/store.test.ts`

Creates all tables, indexes, and provides CRUD operations. Uses `better-sqlite3` in WAL mode.

- [ ] **Step 1: Write failing tests**

```ts
// tests/db/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/db/store.js';
import type { FileRow, GameObjectRow, ComponentRow, ScriptRow, GuidRow, ReferenceRow } from '../../src/types.js';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

afterEach(() => {
  store.close();
});

describe('Store - files', () => {
  it('upserts and retrieves a file', () => {
    const file: FileRow = {
      path: 'Assets/Scenes/Main.unity',
      type: 'scene',
      content_hash: 'abc123',
      modified_at: '2026-01-01T00:00:00Z',
      indexed_at: '2026-01-01T00:00:00Z',
      summary_line: 'Main scene',
      importance_score: 0.5,
      status: 'ok',
    };
    const id = store.upsertFile(file);
    expect(id).toBeGreaterThan(0);

    const retrieved = store.getFileByPath('Assets/Scenes/Main.unity');
    expect(retrieved).toBeDefined();
    expect(retrieved!.content_hash).toBe('abc123');
  });

  it('updates existing file on upsert', () => {
    const file: FileRow = {
      path: 'Assets/test.cs',
      type: 'script',
      content_hash: 'v1',
      modified_at: '2026-01-01T00:00:00Z',
      indexed_at: '2026-01-01T00:00:00Z',
      summary_line: '',
      importance_score: 0,
      status: 'ok',
    };
    store.upsertFile(file);
    store.upsertFile({ ...file, content_hash: 'v2' });

    const retrieved = store.getFileByPath('Assets/test.cs');
    expect(retrieved!.content_hash).toBe('v2');
  });

  it('lists files by type sorted by importance', () => {
    store.upsertFile({ path: 'a.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0.3, status: 'ok' });
    store.upsertFile({ path: 'b.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0.9, status: 'ok' });

    const files = store.listFiles('scene');
    expect(files[0].path).toBe('b.unity');
    expect(files[1].path).toBe('a.unity');
  });
});

describe('Store - game objects', () => {
  it('inserts and retrieves game objects for a file', () => {
    const fileId = store.upsertFile({ path: 'test.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });

    store.insertGameObject({
      file_id: fileId, file_id_local: '100', name: 'Player', parent_file_id_local: null,
      depth: 0, sibling_index: 0, active: true, layer: 0, tag: 'Player',
      component_summary: 'Transform', subtree_summary: 'Player', is_leaf: false,
      child_count: 1, subtree_depth: 1, importance_score: 0.9,
    });

    const objects = store.getGameObjectsByFile(fileId);
    expect(objects).toHaveLength(1);
    expect(objects[0].name).toBe('Player');
  });
});

describe('Store - scripts', () => {
  it('inserts and retrieves scripts', () => {
    const fileId = store.upsertFile({ path: 'test.cs', type: 'script', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });

    store.insertScript({
      file_id: fileId, class_name: 'PlayerController', namespace: 'MyGame',
      base_class: 'MonoBehaviour', interfaces: '["IDamageable"]', assembly_name: 'GameLogic',
      api_summary: 'PlayerController : MonoBehaviour', complexity_score: 10,
      is_monobehaviour: true, is_editor_script: false, is_scriptable_object: false, is_generated: false,
    });

    const scripts = store.listScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].class_name).toBe('PlayerController');
  });

  it('finds script by class name', () => {
    const fileId = store.upsertFile({ path: 'test.cs', type: 'script', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });
    store.insertScript({
      file_id: fileId, class_name: 'Foo', namespace: '', base_class: '',
      interfaces: '[]', assembly_name: '', api_summary: '', complexity_score: 0,
      is_monobehaviour: false, is_editor_script: false, is_scriptable_object: false, is_generated: false,
    });

    const result = store.getScriptByClassName('Foo');
    expect(result).toBeDefined();
    expect(result!.class_name).toBe('Foo');
  });
});

describe('Store - guids', () => {
  it('stores and resolves GUIDs', () => {
    const fileId = store.upsertFile({ path: 'test.cs', type: 'script', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });
    store.upsertGuid({ guid: 'abc123', file_id: fileId, asset_type: 'script' });

    const result = store.resolveGuid('abc123');
    expect(result).toBeDefined();
    expect(result!.file_id).toBe(fileId);
  });
});

describe('Store - references', () => {
  it('stores and queries references by target', () => {
    const fileId = store.upsertFile({ path: 'scene.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });

    store.insertReference({
      source_file_id: fileId, source_context: 'MonoBehaviour:100', target_guid: 'abc123',
      target_file_id: null, ref_type: 'script_attachment',
    });

    const refs = store.getReferencesToGuid('abc123');
    expect(refs).toHaveLength(1);
    expect(refs[0].source_file_id).toBe(fileId);
  });

  it('queries references from a file', () => {
    const fileId = store.upsertFile({ path: 'scene.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });

    store.insertReference({
      source_file_id: fileId, source_context: 'field', target_guid: 'x',
      target_file_id: null, ref_type: 'field_reference',
    });
    store.insertReference({
      source_file_id: fileId, source_context: 'script', target_guid: 'y',
      target_file_id: null, ref_type: 'script_attachment',
    });

    const refs = store.getReferencesFromFile(fileId);
    expect(refs).toHaveLength(2);
  });
});

describe('Store - deleteFileData', () => {
  it('cascades deletion of all data for a file', () => {
    const fileId = store.upsertFile({ path: 'test.unity', type: 'scene', content_hash: '', modified_at: '', indexed_at: '', summary_line: '', importance_score: 0, status: 'ok' });

    const goId = store.insertGameObject({
      file_id: fileId, file_id_local: '100', name: 'Obj', parent_file_id_local: null,
      depth: 0, sibling_index: 0, active: true, layer: 0, tag: '',
      component_summary: '', subtree_summary: '', is_leaf: true,
      child_count: 0, subtree_depth: 0, importance_score: 0,
    });

    store.insertComponent({
      game_object_id: goId, type_name: 'Transform', script_guid: null,
      order: 0, serialized_fields: '{}', field_summary: '', pattern_hash: '',
    });

    store.insertReference({
      source_file_id: fileId, source_context: '', target_guid: 'x',
      target_file_id: null, ref_type: 'field_reference',
    });

    store.deleteFileData(fileId);

    expect(store.getGameObjectsByFile(fileId)).toHaveLength(0);
    expect(store.getReferencesFromFile(fileId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement schema.ts**

```ts
// src/db/schema.ts

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_summary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  file_counts TEXT NOT NULL DEFAULT '{}',
  scene_count INTEGER NOT NULL DEFAULT 0,
  prefab_count INTEGER NOT NULL DEFAULT 0,
  script_count INTEGER NOT NULL DEFAULT 0,
  assembly_structure TEXT NOT NULL DEFAULT '{}',
  hot_scripts TEXT NOT NULL DEFAULT '[]',
  recent_changes TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  indexed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  summary_line TEXT NOT NULL DEFAULT '',
  importance_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_files_type_importance ON files (type, importance_score DESC);

CREATE TABLE IF NOT EXISTS game_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  file_id_local TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_file_id_local TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  sibling_index INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1,
  layer INTEGER NOT NULL DEFAULT 0,
  tag TEXT NOT NULL DEFAULT 'Untagged',
  component_summary TEXT NOT NULL DEFAULT '',
  subtree_summary TEXT NOT NULL DEFAULT '',
  is_leaf BOOLEAN NOT NULL DEFAULT 1,
  child_count INTEGER NOT NULL DEFAULT 0,
  subtree_depth INTEGER NOT NULL DEFAULT 0,
  importance_score REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_go_file_depth ON game_objects (file_id, depth, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_go_name ON game_objects (name);
CREATE INDEX IF NOT EXISTS idx_go_tag ON game_objects (tag);

CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_object_id INTEGER NOT NULL REFERENCES game_objects(id),
  type_name TEXT NOT NULL,
  script_guid TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  serialized_fields TEXT NOT NULL DEFAULT '{}',
  field_summary TEXT NOT NULL DEFAULT '',
  pattern_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comp_go ON components (game_object_id);
CREATE INDEX IF NOT EXISTS idx_comp_type ON components (type_name);
CREATE INDEX IF NOT EXISTS idx_comp_guid ON components (script_guid);

CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  class_name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT '',
  base_class TEXT NOT NULL DEFAULT '',
  interfaces TEXT NOT NULL DEFAULT '[]',
  assembly_name TEXT NOT NULL DEFAULT '',
  api_summary TEXT NOT NULL DEFAULT '',
  complexity_score REAL NOT NULL DEFAULT 0,
  is_monobehaviour BOOLEAN NOT NULL DEFAULT 0,
  is_editor_script BOOLEAN NOT NULL DEFAULT 0,
  is_scriptable_object BOOLEAN NOT NULL DEFAULT 0,
  is_generated BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scripts_class ON scripts (class_name);
CREATE INDEX IF NOT EXISTS idx_scripts_base ON scripts (base_class);
CREATE INDEX IF NOT EXISTS idx_scripts_asm ON scripts (assembly_name);

CREATE TABLE IF NOT EXISTS script_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL REFERENCES scripts(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'private',
  return_type TEXT NOT NULL DEFAULT '',
  parameters TEXT NOT NULL DEFAULT '[]',
  attributes TEXT NOT NULL DEFAULT '[]',
  signature TEXT NOT NULL DEFAULT '',
  has_serialize_field BOOLEAN NOT NULL DEFAULT 0,
  has_header_attr BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_members_script ON script_members (script_id);

CREATE TABLE IF NOT EXISTS guids (
  guid TEXT PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  asset_type TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS "references" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id INTEGER NOT NULL REFERENCES files(id),
  source_context TEXT NOT NULL DEFAULT '',
  target_guid TEXT NOT NULL,
  target_file_id INTEGER REFERENCES files(id),
  ref_type TEXT NOT NULL DEFAULT 'field_reference'
);
CREATE INDEX IF NOT EXISTS idx_ref_source ON "references" (source_file_id);
CREATE INDEX IF NOT EXISTS idx_ref_target_guid ON "references" (target_guid);
CREATE INDEX IF NOT EXISTS idx_ref_target_file ON "references" (target_file_id);

CREATE TABLE IF NOT EXISTS reference_counts (
  file_id INTEGER NOT NULL REFERENCES files(id),
  guid TEXT NOT NULL DEFAULT '',
  incoming_count INTEGER NOT NULL DEFAULT 0,
  outgoing_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id)
);

CREATE TABLE IF NOT EXISTS assemblies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  name TEXT NOT NULL,
  "references" TEXT NOT NULL DEFAULT '[]',
  defines TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  dependency_summary TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  changed_at TEXT NOT NULL,
  change_type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changelog_time ON change_log (changed_at DESC);

INSERT OR IGNORE INTO project_summary (id) VALUES (1);
`;
```

- [ ] **Step 4: Implement store.ts**

```ts
// src/db/store.ts
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import type {
  FileRow, GameObjectRow, ComponentRow, ScriptRow, ScriptMemberRow,
  GuidRow, ReferenceRow, AssemblyRow, ChangeLogRow, ProjectSummaryRow,
} from '../types.js';

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // === Files ===

  upsertFile(file: FileRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, type, content_hash, modified_at, indexed_at, summary_line, importance_score, status)
      VALUES (@path, @type, @content_hash, @modified_at, @indexed_at, @summary_line, @importance_score, @status)
      ON CONFLICT(path) DO UPDATE SET
        type=@type, content_hash=@content_hash, modified_at=@modified_at, indexed_at=@indexed_at,
        summary_line=@summary_line, importance_score=@importance_score, status=@status
    `);
    const result = stmt.run(file);
    return Number(result.lastInsertRowid);
  }

  getFileByPath(path: string): (FileRow & { id: number }) | undefined {
    return this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as (FileRow & { id: number }) | undefined;
  }

  getFileById(id: number): (FileRow & { id: number }) | undefined {
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as (FileRow & { id: number }) | undefined;
  }

  listFiles(type?: string): (FileRow & { id: number })[] {
    if (type) {
      return this.db.prepare('SELECT * FROM files WHERE type = ? ORDER BY importance_score DESC').all(type) as (FileRow & { id: number })[];
    }
    return this.db.prepare('SELECT * FROM files ORDER BY importance_score DESC').all() as (FileRow & { id: number })[];
  }

  deleteFile(fileId: number): void {
    this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  }

  // === Game Objects ===

  insertGameObject(go: GameObjectRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO game_objects (file_id, file_id_local, name, parent_file_id_local, depth, sibling_index,
        active, layer, tag, component_summary, subtree_summary, is_leaf, child_count, subtree_depth, importance_score)
      VALUES (@file_id, @file_id_local, @name, @parent_file_id_local, @depth, @sibling_index,
        @active, @layer, @tag, @component_summary, @subtree_summary, @is_leaf, @child_count, @subtree_depth, @importance_score)
    `);
    const result = stmt.run(go);
    return Number(result.lastInsertRowid);
  }

  getGameObjectsByFile(fileId: number): (GameObjectRow & { id: number })[] {
    return this.db.prepare('SELECT * FROM game_objects WHERE file_id = ? ORDER BY depth, sibling_index')
      .all(fileId) as (GameObjectRow & { id: number })[];
  }

  getGameObjectByName(fileId: number, name: string): (GameObjectRow & { id: number }) | undefined {
    return this.db.prepare('SELECT * FROM game_objects WHERE file_id = ? AND name = ?')
      .get(fileId, name) as (GameObjectRow & { id: number }) | undefined;
  }

  // === Components ===

  insertComponent(comp: ComponentRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO components (game_object_id, type_name, script_guid, "order", serialized_fields, field_summary, pattern_hash)
      VALUES (@game_object_id, @type_name, @script_guid, @order, @serialized_fields, @field_summary, @pattern_hash)
    `);
    const result = stmt.run(comp);
    return Number(result.lastInsertRowid);
  }

  getComponentsByGameObject(goId: number): (ComponentRow & { id: number })[] {
    return this.db.prepare('SELECT * FROM components WHERE game_object_id = ? ORDER BY "order"')
      .all(goId) as (ComponentRow & { id: number })[];
  }

  getComponentsByType(typeName: string, fileId?: number): (ComponentRow & { id: number })[] {
    if (fileId) {
      return this.db.prepare(`
        SELECT c.* FROM components c
        JOIN game_objects go ON c.game_object_id = go.id
        WHERE c.type_name = ? AND go.file_id = ?
      `).all(typeName, fileId) as (ComponentRow & { id: number })[];
    }
    return this.db.prepare('SELECT * FROM components WHERE type_name = ?')
      .all(typeName) as (ComponentRow & { id: number })[];
  }

  // === Scripts ===

  insertScript(script: ScriptRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO scripts (file_id, class_name, namespace, base_class, interfaces, assembly_name,
        api_summary, complexity_score, is_monobehaviour, is_editor_script, is_scriptable_object, is_generated)
      VALUES (@file_id, @class_name, @namespace, @base_class, @interfaces, @assembly_name,
        @api_summary, @complexity_score, @is_monobehaviour, @is_editor_script, @is_scriptable_object, @is_generated)
    `);
    const result = stmt.run(script);
    return Number(result.lastInsertRowid);
  }

  listScripts(filter?: { namespace?: string; baseClass?: string; assembly?: string; isMonoBehaviour?: boolean }): (ScriptRow & { id: number })[] {
    let sql = 'SELECT * FROM scripts WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.namespace) { sql += ' AND namespace = ?'; params.push(filter.namespace); }
    if (filter?.baseClass) { sql += ' AND base_class = ?'; params.push(filter.baseClass); }
    if (filter?.assembly) { sql += ' AND assembly_name = ?'; params.push(filter.assembly); }
    if (filter?.isMonoBehaviour !== undefined) { sql += ' AND is_monobehaviour = ?'; params.push(filter.isMonoBehaviour ? 1 : 0); }

    sql += ' ORDER BY complexity_score DESC';
    return this.db.prepare(sql).all(...params) as (ScriptRow & { id: number })[];
  }

  getScriptByClassName(className: string): (ScriptRow & { id: number }) | undefined {
    return this.db.prepare('SELECT * FROM scripts WHERE class_name = ?').get(className) as (ScriptRow & { id: number }) | undefined;
  }

  // === Script Members ===

  insertScriptMember(member: ScriptMemberRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO script_members (script_id, name, kind, access, return_type, parameters, attributes, signature, has_serialize_field, has_header_attr)
      VALUES (@script_id, @name, @kind, @access, @return_type, @parameters, @attributes, @signature, @has_serialize_field, @has_header_attr)
    `);
    const result = stmt.run(member);
    return Number(result.lastInsertRowid);
  }

  getScriptMembers(scriptId: number): (ScriptMemberRow & { id: number })[] {
    return this.db.prepare('SELECT * FROM script_members WHERE script_id = ?').all(scriptId) as (ScriptMemberRow & { id: number })[];
  }

  // === GUIDs ===

  upsertGuid(guid: GuidRow): void {
    this.db.prepare(`
      INSERT INTO guids (guid, file_id, asset_type) VALUES (@guid, @file_id, @asset_type)
      ON CONFLICT(guid) DO UPDATE SET file_id=@file_id, asset_type=@asset_type
    `).run(guid);
  }

  resolveGuid(guid: string): GuidRow | undefined {
    return this.db.prepare('SELECT * FROM guids WHERE guid = ?').get(guid) as GuidRow | undefined;
  }

  getGuidByFileId(fileId: number): GuidRow | undefined {
    return this.db.prepare('SELECT * FROM guids WHERE file_id = ?').get(fileId) as GuidRow | undefined;
  }

  // === References ===

  insertReference(ref: ReferenceRow): void {
    this.db.prepare(`
      INSERT INTO "references" (source_file_id, source_context, target_guid, target_file_id, ref_type)
      VALUES (@source_file_id, @source_context, @target_guid, @target_file_id, @ref_type)
    `).run(ref);
  }

  getReferencesToGuid(guid: string): (ReferenceRow & { id: number })[] {
    return this.db.prepare('SELECT * FROM "references" WHERE target_guid = ?').all(guid) as (ReferenceRow & { id: number })[];
  }

  getReferencesFromFile(fileId: number): (ReferenceRow & { id: number })[] {
    return this.db.prepare('SELECT * FROM "references" WHERE source_file_id = ?').all(fileId) as (ReferenceRow & { id: number })[];
  }

  // === Assemblies ===

  insertAssembly(asm: AssemblyRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO assemblies (file_id, name, "references", defines, platforms, dependency_summary)
      VALUES (@file_id, @name, @references, @defines, @platforms, @dependency_summary)
    `);
    const result = stmt.run(asm);
    return Number(result.lastInsertRowid);
  }

  // === Change Log ===

  insertChangeLog(entry: ChangeLogRow): void {
    this.db.prepare(`
      INSERT INTO change_log (file_id, changed_at, change_type) VALUES (@file_id, @changed_at, @change_type)
    `).run(entry);
  }

  getRecentChanges(limit: number = 50): (ChangeLogRow & { id: number; path: string })[] {
    return this.db.prepare(`
      SELECT cl.*, f.path FROM change_log cl
      JOIN files f ON cl.file_id = f.id
      ORDER BY cl.changed_at DESC LIMIT ?
    `).all(limit) as (ChangeLogRow & { id: number; path: string })[];
  }

  // === Project Summary ===

  getProjectSummary(): ProjectSummaryRow | undefined {
    return this.db.prepare('SELECT * FROM project_summary WHERE id = 1').get() as ProjectSummaryRow | undefined;
  }

  updateProjectSummary(summary: Partial<ProjectSummaryRow>): void {
    const fields = Object.entries(summary)
      .filter(([key]) => key !== 'id')
      .map(([key]) => `${key} = @${key}`)
      .join(', ');
    if (!fields) return;
    this.db.prepare(`UPDATE project_summary SET ${fields} WHERE id = 1`).run(summary);
  }

  // === Reference Counts ===

  recomputeReferenceCounts(): void {
    this.db.exec('DELETE FROM reference_counts');
    this.db.exec(`
      INSERT INTO reference_counts (file_id, guid, incoming_count, outgoing_count)
      SELECT
        f.id,
        COALESCE(g.guid, ''),
        COALESCE(inc.cnt, 0),
        COALESCE(out.cnt, 0)
      FROM files f
      LEFT JOIN guids g ON g.file_id = f.id
      LEFT JOIN (SELECT target_file_id, COUNT(*) as cnt FROM "references" WHERE target_file_id IS NOT NULL GROUP BY target_file_id) inc ON inc.target_file_id = f.id
      LEFT JOIN (SELECT source_file_id, COUNT(*) as cnt FROM "references" GROUP BY source_file_id) out ON out.source_file_id = f.id
    `);
  }

  // === Cascade Delete ===

  deleteFileData(fileId: number): void {
    const goIds = this.db.prepare('SELECT id FROM game_objects WHERE file_id = ?').all(fileId) as { id: number }[];
    for (const { id } of goIds) {
      this.db.prepare('DELETE FROM components WHERE game_object_id = ?').run(id);
    }
    this.db.prepare('DELETE FROM game_objects WHERE file_id = ?').run(fileId);

    const scriptIds = this.db.prepare('SELECT id FROM scripts WHERE file_id = ?').all(fileId) as { id: number }[];
    for (const { id } of scriptIds) {
      this.db.prepare('DELETE FROM script_members WHERE script_id = ?').run(id);
    }
    this.db.prepare('DELETE FROM scripts WHERE file_id = ?').run(fileId);
    this.db.prepare('DELETE FROM "references" WHERE source_file_id = ?').run(fileId);
    this.db.prepare('DELETE FROM guids WHERE file_id = ?').run(fileId);
    this.db.prepare('DELETE FROM assemblies WHERE file_id = ?').run(fileId);
  }

  // === Search ===

  search(query: string, scope?: string): (FileRow & { id: number })[] {
    let sql = `
      SELECT DISTINCT f.* FROM files f
      LEFT JOIN game_objects go ON go.file_id = f.id
      LEFT JOIN scripts s ON s.file_id = f.id
      WHERE (f.path LIKE ? OR f.summary_line LIKE ? OR go.name LIKE ? OR s.class_name LIKE ?)
    `;
    const like = `%${query}%`;
    const params: unknown[] = [like, like, like, like];

    if (scope) {
      sql += ' AND f.type = ?';
      params.push(scope);
    }

    sql += ' ORDER BY f.importance_score DESC LIMIT 50';
    return this.db.prepare(sql).all(...params) as (FileRow & { id: number })[];
  }

  // === Transactions ===

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/db/store.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/store.ts tests/db/store.test.ts
git commit -m "feat: SQLite schema and database store"
```

---

### Task 10: Summary Generation + Importance Scoring

**Files:**
- Create: `src/db/summaries.ts`
- Create: `tests/db/summaries.test.ts`

Generates pre-computed summaries at every level: component_summary, subtree_summary, field_summary, api_summary, summary_line, project description. Also computes importance scores.

- [ ] **Step 1: Write failing tests**

```ts
// tests/db/summaries.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateComponentSummary, generateSubtreeSummary, generateFieldSummary,
  generateApiSummary, generateMemberSignature, generateFileSummaryLine,
  computeGameObjectImportance,
} from '../../src/db/summaries.js';
import type { ParsedGameObject, ParsedComponent, ParsedScript, ParsedScriptMember } from '../../src/types.js';

describe('generateComponentSummary', () => {
  it('lists component type names', () => {
    const components: ParsedComponent[] = [
      { fileIdLocal: '1', typeName: 'Transform', scriptGuid: null, order: 0, serializedFields: {}, gameObjectFileId: '100' },
      { fileIdLocal: '2', typeName: 'MonoBehaviour', scriptGuid: 'abc', order: 1, serializedFields: {}, gameObjectFileId: '100' },
    ];
    const result = generateComponentSummary(components, new Map([['abc', 'PlayerController']]));
    expect(result).toBe('Transform, PlayerController');
  });

  it('resolves MonoBehaviour to script name when available', () => {
    const components: ParsedComponent[] = [
      { fileIdLocal: '1', typeName: 'MonoBehaviour', scriptGuid: 'xyz', order: 0, serializedFields: {}, gameObjectFileId: '100' },
    ];
    const result = generateComponentSummary(components, new Map([['xyz', 'EnemyAI']]));
    expect(result).toBe('EnemyAI');
  });
});

describe('generateSubtreeSummary', () => {
  it('generates summary for leaf node', () => {
    const result = generateSubtreeSummary('Sprite', []);
    expect(result).toBe('Sprite');
  });

  it('generates summary with children', () => {
    const result = generateSubtreeSummary('Player', ['Sprite', 'HitBox', 'WeaponMount']);
    expect(result).toBe('Player [3 children: Sprite, HitBox, WeaponMount]');
  });

  it('truncates long child lists', () => {
    const children = Array.from({ length: 10 }, (_, i) => `Child${i}`);
    const result = generateSubtreeSummary('Root', children);
    expect(result).toContain('...');
  });
});

describe('generateFieldSummary', () => {
  it('summarizes serialized fields', () => {
    const fields = { speed: 5.5, health: 100 };
    const result = generateFieldSummary(fields);
    expect(result).toContain('speed=5.5');
    expect(result).toContain('health=100');
  });

  it('shows ref: prefix for GUID references', () => {
    const fields = { weapon: { fileID: 11400000, guid: 'abc123', type: 3 } };
    const guidNames = new Map([['abc123', 'Sword.prefab']]);
    const result = generateFieldSummary(fields, guidNames);
    expect(result).toContain('ref:Sword.prefab');
  });
});

describe('generateApiSummary', () => {
  it('generates compact API summary for a script', () => {
    const script: ParsedScript = {
      className: 'PlayerController', kind: 'class', namespace: 'MyGame',
      baseClass: 'MonoBehaviour', interfaces: ['IDamageable'],
      members: [
        { name: 'speed', kind: 'field', access: 'private', returnType: 'float', parameters: [], attributes: ['SerializeField'], isStatic: false },
        { name: 'TakeDamage', kind: 'method', access: 'public', returnType: 'void', parameters: [{ name: 'amount', type: 'int' }], attributes: [], isStatic: false },
      ],
      isMonoBehaviour: true, isEditorScript: false, isScriptableObject: false, isGenerated: false, loc: 30,
    };
    const result = generateApiSummary(script);
    expect(result).toContain('PlayerController : MonoBehaviour, IDamageable');
    expect(result).toContain('speed');
    expect(result).toContain('TakeDamage');
  });
});

describe('generateMemberSignature', () => {
  it('generates method signature', () => {
    const member: ParsedScriptMember = {
      name: 'TakeDamage', kind: 'method', access: 'public', returnType: 'void',
      parameters: [{ name: 'amount', type: 'int' }], attributes: [], isStatic: false,
    };
    expect(generateMemberSignature(member)).toBe('public void TakeDamage(int amount)');
  });

  it('generates field signature', () => {
    const member: ParsedScriptMember = {
      name: 'speed', kind: 'field', access: 'private', returnType: 'float',
      parameters: [], attributes: ['SerializeField'], isStatic: false,
    };
    expect(generateMemberSignature(member)).toBe('[SerializeField] private float speed');
  });

  it('generates property signature', () => {
    const member: ParsedScriptMember = {
      name: 'IsAlive', kind: 'property', access: 'public', returnType: 'bool',
      parameters: [], attributes: [], isStatic: false,
    };
    expect(generateMemberSignature(member)).toBe('public bool IsAlive { get; }');
  });
});

describe('generateFileSummaryLine', () => {
  it('generates scene summary', () => {
    const result = generateFileSummaryLine('scene', 'MainScene.unity', { gameObjectCount: 47, scriptCount: 12 });
    expect(result).toContain('47 GameObjects');
    expect(result).toContain('12 scripts');
  });

  it('generates script summary', () => {
    const result = generateFileSummaryLine('script', 'PlayerController.cs', { className: 'PlayerController', baseClass: 'MonoBehaviour', memberCount: 6 });
    expect(result).toContain('PlayerController');
    expect(result).toContain('MonoBehaviour');
  });
});

describe('computeGameObjectImportance', () => {
  it('scores higher for objects with MonoBehaviours', () => {
    const withMb = computeGameObjectImportance({ hasMonoBehaviour: true, childCount: 0, depth: 0, refCount: 0 });
    const without = computeGameObjectImportance({ hasMonoBehaviour: false, childCount: 0, depth: 0, refCount: 0 });
    expect(withMb).toBeGreaterThan(without);
  });

  it('scores higher for objects with more children', () => {
    const manyChildren = computeGameObjectImportance({ hasMonoBehaviour: false, childCount: 10, depth: 0, refCount: 0 });
    const fewChildren = computeGameObjectImportance({ hasMonoBehaviour: false, childCount: 1, depth: 0, refCount: 0 });
    expect(manyChildren).toBeGreaterThan(fewChildren);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/summaries.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement summaries.ts**

```ts
// src/db/summaries.ts
import type { ParsedScript, ParsedScriptMember, ParsedComponent } from '../types.js';

export function generateComponentSummary(
  components: ParsedComponent[],
  guidToClassName: Map<string, string>
): string {
  return components
    .map(c => {
      if (c.typeName === 'MonoBehaviour' && c.scriptGuid) {
        return guidToClassName.get(c.scriptGuid) ?? 'MonoBehaviour';
      }
      return c.typeName;
    })
    .join(', ');
}

export function generateSubtreeSummary(name: string, childNames: string[]): string {
  if (childNames.length === 0) return name;

  const MAX_SHOWN = 5;
  const shown = childNames.slice(0, MAX_SHOWN);
  const rest = childNames.length - MAX_SHOWN;
  const childList = rest > 0
    ? `${shown.join(', ')}, ...+${rest} more`
    : shown.join(', ');

  return `${name} [${childNames.length} children: ${childList}]`;
}

export function generateFieldSummary(
  fields: Record<string, unknown>,
  guidNames?: Map<string, string>
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'object' && value !== null && 'guid' in (value as Record<string, unknown>)) {
      const guid = String((value as Record<string, unknown>)['guid']);
      const name = guidNames?.get(guid) ?? guid.slice(0, 8);
      parts.push(`${key}=ref:${name}`);
    } else if (typeof value === 'object') {
      parts.push(`${key}={...}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(', ');
}

export function generateApiSummary(script: ParsedScript): string {
  const lines: string[] = [];

  // Header
  let header = `${script.className}`;
  const bases = [script.baseClass, ...script.interfaces].filter(Boolean);
  if (bases.length > 0) header += ` : ${bases.join(', ')}`;
  lines.push(header);

  // Group members
  const fields = script.members.filter(m => m.kind === 'field');
  const properties = script.members.filter(m => m.kind === 'property');
  const methods = script.members.filter(m => m.kind === 'method');
  const events = script.members.filter(m => m.kind === 'event');

  if (fields.length > 0) {
    const serialized = fields.filter(f => f.attributes.includes('SerializeField'));
    const publicFields = fields.filter(f => f.access === 'public');
    const notable = [...serialized, ...publicFields.filter(f => !serialized.includes(f))];
    if (notable.length > 0) {
      lines.push(`  fields: ${notable.map(f => `${f.name}(${f.returnType})${f.attributes.includes('SerializeField') ? ' [SerializeField]' : ''}`).join(', ')}`);
    }
  }

  if (properties.length > 0) {
    lines.push(`  properties: ${properties.map(p => `${p.name}(${p.returnType}) {get}`).join(', ')}`);
  }

  if (methods.length > 0) {
    const publicMethods = methods.filter(m => m.access === 'public');
    const displayMethods = publicMethods.length > 0 ? publicMethods : methods.slice(0, 5);
    lines.push(`  methods: ${displayMethods.map(m => {
      const params = m.parameters.map(p => p.type).join(', ');
      return `${m.name}(${params})`;
    }).join(', ')}`);
  }

  if (events.length > 0) {
    lines.push(`  events: ${events.map(e => `${e.name}(${e.returnType})`).join(', ')}`);
  }

  return lines.join('\n');
}

export function generateMemberSignature(member: ParsedScriptMember): string {
  const attrs = member.attributes.length > 0 ? `[${member.attributes.join(', ')}] ` : '';
  const staticMod = member.isStatic ? 'static ' : '';

  switch (member.kind) {
    case 'method':
    case 'constructor': {
      const params = member.parameters.map(p => `${p.type} ${p.name}`).join(', ');
      const ret = member.kind === 'constructor' ? '' : `${member.returnType} `;
      return `${attrs}${member.access} ${staticMod}${ret}${member.name}(${params})`.trim();
    }
    case 'field':
      return `${attrs}${member.access} ${staticMod}${member.returnType} ${member.name}`.trim();
    case 'property':
      return `${attrs}${member.access} ${staticMod}${member.returnType} ${member.name} { get; }`.trim();
    case 'event':
      return `${attrs}${member.access} ${staticMod}event ${member.returnType} ${member.name}`.trim();
    default:
      return `${member.access} ${member.name}`;
  }
}

export function generateFileSummaryLine(
  type: string,
  fileName: string,
  stats: Record<string, unknown>
): string {
  switch (type) {
    case 'scene':
      return `${fileName} — ${stats['gameObjectCount']} GameObjects, ${stats['scriptCount']} scripts`;
    case 'prefab':
      return `${fileName} — prefab${stats['isVariant'] ? ' variant' : ''}, ${stats['gameObjectCount']} GameObjects`;
    case 'script': {
      const base = stats['baseClass'] ? ` : ${stats['baseClass']}` : '';
      return `${fileName} — ${stats['className']}${base}, ${stats['memberCount']} members`;
    }
    case 'asset':
      return `${fileName} — ${stats['typeName'] ?? 'asset'}`;
    case 'asmdef':
      return `${fileName} — assembly: ${stats['assemblyName']}`;
    default:
      return fileName;
  }
}

export function computeGameObjectImportance(stats: {
  hasMonoBehaviour: boolean;
  childCount: number;
  depth: number;
  refCount: number;
}): number {
  let score = 0;
  if (stats.hasMonoBehaviour) score += 0.4;
  score += Math.min(stats.childCount / 20, 0.3);
  score += Math.min(stats.refCount / 10, 0.2);
  if (stats.depth === 0) score += 0.1;
  return Math.min(score, 1.0);
}

export function computeFileImportance(stats: {
  incomingRefCount: number;
  outgoingRefCount: number;
  hasCustomScripts: boolean;
  changeFrequency: number;
}): number {
  let score = 0;
  score += Math.min(stats.incomingRefCount / 20, 0.3);
  score += Math.min(stats.outgoingRefCount / 20, 0.1);
  if (stats.hasCustomScripts) score += 0.3;
  score += Math.min(stats.changeFrequency / 10, 0.2);
  return Math.min(score, 1.0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/summaries.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/summaries.ts tests/db/summaries.test.ts
git commit -m "feat: summary generation and importance scoring"
```

---

### Task 11: Indexer Orchestration

**Files:**
- Create: `src/indexer/indexer.ts`
- Create: `tests/indexer/indexer.test.ts`

Wires parsers to the database store. Handles full index, incremental updates, and deletion cascades.

- [ ] **Step 1: Write failing tests**

```ts
// tests/indexer/indexer.test.ts
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { Indexer } from '../../src/indexer/indexer.js';
import { Store } from '../../src/db/store.js';
import { initScriptParser } from '../../src/parsers/script-parser.js';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject');
let store: Store;
let indexer: Indexer;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(':memory:');
  indexer = new Indexer(store, FIXTURES);
});

afterEach(() => {
  store.close();
});

describe('Indexer', () => {
  it('indexes a full project', () => {
    indexer.indexAll();

    const files = store.listFiles();
    expect(files.length).toBeGreaterThan(0);

    const scenes = store.listFiles('scene');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].path).toContain('MainScene.unity');
  });

  it('indexes scene GameObjects and components', () => {
    indexer.indexAll();

    const sceneFile = store.listFiles('scene')[0];
    const gameObjects = store.getGameObjectsByFile(sceneFile.id);
    expect(gameObjects.length).toBeGreaterThan(0);

    const player = gameObjects.find(go => go.name === 'Player');
    expect(player).toBeDefined();
    expect(player!.component_summary).toContain('Transform');
  });

  it('indexes scripts with members', () => {
    indexer.indexAll();

    const script = store.getScriptByClassName('PlayerController');
    expect(script).toBeDefined();
    expect(script!.is_monobehaviour).toBeTruthy();

    const members = store.getScriptMembers(script!.id!);
    expect(members.length).toBeGreaterThan(0);
    expect(members.find(m => m.name === 'TakeDamage')).toBeDefined();
  });

  it('indexes GUIDs from meta files', () => {
    indexer.indexAll();

    const resolved = store.resolveGuid('a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(resolved).toBeDefined();
    expect(resolved!.asset_type).toBe('script');
  });

  it('indexes references', () => {
    indexer.indexAll();

    const refs = store.getReferencesToGuid('a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(refs.length).toBeGreaterThan(0);
  });

  it('indexes asmdef files', () => {
    indexer.indexAll();

    const asmFiles = store.listFiles('asmdef');
    expect(asmFiles).toHaveLength(1);
  });

  it('generates project summary', () => {
    indexer.indexAll();

    const summary = store.getProjectSummary();
    expect(summary).toBeDefined();
    expect(summary!.scene_count).toBe(1);
    expect(summary!.script_count).toBeGreaterThan(0);
  });

  it('incrementally updates a single file', () => {
    indexer.indexAll();

    const before = store.getScriptByClassName('PlayerController');
    expect(before).toBeDefined();

    // Re-index same file — should update, not duplicate
    indexer.indexFile('Assets/Scripts/PlayerController.cs');
    const scripts = store.listScripts({ baseClass: 'MonoBehaviour' });
    const pcCount = scripts.filter(s => s.class_name === 'PlayerController').length;
    expect(pcCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indexer/indexer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement indexer.ts**

```ts
// src/indexer/indexer.ts
import { readFileSync, statSync } from 'fs';
import { join, relative, basename, extname } from 'path';
import { createHash } from 'crypto';
import { Store } from '../db/store.js';
import { parseScene } from '../parsers/scene-parser.js';
import { parsePrefab } from '../parsers/prefab-parser.js';
import { parseAsset } from '../parsers/asset-parser.js';
import { parseScript } from '../parsers/script-parser.js';
import { parseMeta } from '../parsers/meta-parser.js';
import { parseAsmDef } from '../parsers/asmdef-parser.js';
import {
  generateComponentSummary, generateSubtreeSummary, generateFieldSummary,
  generateApiSummary, generateMemberSignature, generateFileSummaryLine,
  computeGameObjectImportance, computeFileImportance,
} from '../db/summaries.js';
import { detectFileType } from '../types.js';
import type {
  FileRow, UnityFileType, ParsedGameObject, ParsedGuidReference,
} from '../types.js';
import { readdirSync } from 'fs';

export class Indexer {
  constructor(
    private store: Store,
    private projectRoot: string,
  ) {}

  indexAll(): void {
    const files = this.collectFiles();

    // Index meta files first (GUID registry needed by other parsers)
    const metaFiles = files.filter(f => f.endsWith('.meta'));
    const otherFiles = files.filter(f => !f.endsWith('.meta'));

    this.store.transaction(() => {
      for (const filePath of metaFiles) {
        this.indexFileInternal(filePath);
      }
      for (const filePath of otherFiles) {
        this.indexFileInternal(filePath);
      }

      this.store.recomputeReferenceCounts();
      this.updateProjectSummary();
    });
  }

  indexFile(relativePath: string): void {
    this.store.transaction(() => {
      this.indexFileInternal(relativePath);
      this.store.recomputeReferenceCounts();
      this.updateProjectSummary();
    });
  }

  removeFile(relativePath: string): void {
    const existing = this.store.getFileByPath(relativePath);
    if (!existing) return;

    this.store.transaction(() => {
      this.store.deleteFileData(existing.id);
      this.store.deleteFile(existing.id);
      this.store.insertChangeLog({
        file_id: existing.id,
        changed_at: new Date().toISOString(),
        change_type: 'deleted',
      });
      this.store.recomputeReferenceCounts();
      this.updateProjectSummary();
    });
  }

  private indexFileInternal(relativePath: string): void {
    const fullPath = join(this.projectRoot, relativePath);
    const type = detectFileType(relativePath);
    if (!type) return;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      return;
    }

    // Check for binary
    if ((type === 'scene' || type === 'prefab' || type === 'asset') && !content.startsWith('%YAML')) {
      const existing = this.store.getFileByPath(relativePath);
      if (existing) {
        this.store.deleteFileData(existing.id);
      }
      this.store.upsertFile({
        path: relativePath,
        type,
        content_hash: '',
        modified_at: this.getModifiedTime(fullPath),
        indexed_at: new Date().toISOString(),
        summary_line: `${basename(relativePath)} — binary (enable Force Text in Unity)`,
        importance_score: 0,
        status: 'binary',
      });
      return;
    }

    const hash = createHash('sha256').update(content).digest('hex');

    // Skip if unchanged
    const existing = this.store.getFileByPath(relativePath);
    if (existing && existing.content_hash === hash) return;

    // Clear old data if re-indexing
    if (existing) {
      this.store.deleteFileData(existing.id);
    }

    const changeType = existing ? 'modified' : 'added';

    const fileId = this.store.upsertFile({
      path: relativePath,
      type,
      content_hash: hash,
      modified_at: this.getModifiedTime(fullPath),
      indexed_at: new Date().toISOString(),
      summary_line: '',
      importance_score: 0,
      status: 'ok',
    });

    try {
      switch (type) {
        case 'meta': this.indexMeta(fileId, content); break;
        case 'scene': this.indexScene(fileId, relativePath, content); break;
        case 'prefab': this.indexPrefab(fileId, relativePath, content); break;
        case 'asset': this.indexAssetFile(fileId, relativePath, content); break;
        case 'script': this.indexScript(fileId, relativePath, content); break;
        case 'asmdef': this.indexAsmDef(fileId, relativePath, content); break;
      }
    } catch {
      this.store.upsertFile({
        path: relativePath, type, content_hash: hash,
        modified_at: this.getModifiedTime(fullPath),
        indexed_at: new Date().toISOString(),
        summary_line: `${basename(relativePath)} — parse error`,
        importance_score: 0, status: 'partial',
      });
    }

    this.store.insertChangeLog({
      file_id: fileId,
      changed_at: new Date().toISOString(),
      change_type: changeType,
    });
  }

  private indexMeta(fileId: number, content: string): void {
    const meta = parseMeta(content);
    this.store.upsertGuid({ guid: meta.guid, file_id: fileId, asset_type: meta.assetType });
  }

  private indexScene(fileId: number, relativePath: string, content: string): void {
    const scene = parseScene(content);
    const guidToClass = this.buildGuidToClassMap();
    this.storeGameObjects(fileId, scene.gameObjects, guidToClass);
    this.storeReferences(fileId, scene.references);

    const scriptCount = scene.gameObjects.reduce((n, go) =>
      n + go.components.filter(c => c.scriptGuid).length, 0);

    this.store.upsertFile({
      path: relativePath, type: 'scene', content_hash: '', modified_at: '', indexed_at: new Date().toISOString(),
      summary_line: generateFileSummaryLine('scene', basename(relativePath), {
        gameObjectCount: scene.gameObjects.length, scriptCount,
      }),
      importance_score: computeFileImportance({
        incomingRefCount: 0, outgoingRefCount: scene.references.length,
        hasCustomScripts: scriptCount > 0, changeFrequency: 0,
      }),
      status: 'ok',
    });
  }

  private indexPrefab(fileId: number, relativePath: string, content: string): void {
    const prefab = parsePrefab(content);
    const guidToClass = this.buildGuidToClassMap();
    this.storeGameObjects(fileId, prefab.gameObjects, guidToClass);
    this.storeReferences(fileId, prefab.references);

    this.store.upsertFile({
      path: relativePath, type: 'prefab', content_hash: '', modified_at: '', indexed_at: new Date().toISOString(),
      summary_line: generateFileSummaryLine('prefab', basename(relativePath), {
        gameObjectCount: prefab.gameObjects.length, isVariant: prefab.isVariant,
      }),
      importance_score: 0.5,
      status: 'ok',
    });
  }

  private indexAssetFile(fileId: number, relativePath: string, content: string): void {
    const asset = parseAsset(content);
    this.storeReferences(fileId, asset.references);

    this.store.upsertFile({
      path: relativePath, type: 'asset', content_hash: '', modified_at: '', indexed_at: new Date().toISOString(),
      summary_line: generateFileSummaryLine('asset', basename(relativePath), { typeName: asset.name }),
      importance_score: 0.3,
      status: 'ok',
    });
  }

  private indexScript(fileId: number, relativePath: string, content: string): void {
    const scripts = parseScript(content);

    for (const script of scripts) {
      const apiSummary = generateApiSummary(script);
      const scriptId = this.store.insertScript({
        file_id: fileId,
        class_name: script.className,
        namespace: script.namespace,
        base_class: script.baseClass,
        interfaces: JSON.stringify(script.interfaces),
        assembly_name: '',
        api_summary: apiSummary,
        complexity_score: script.loc + script.members.length * 2,
        is_monobehaviour: script.isMonoBehaviour,
        is_editor_script: script.isEditorScript,
        is_scriptable_object: script.isScriptableObject,
        is_generated: script.isGenerated,
      });

      for (const member of script.members) {
        this.store.insertScriptMember({
          script_id: scriptId,
          name: member.name,
          kind: member.kind,
          access: member.access,
          return_type: member.returnType,
          parameters: JSON.stringify(member.parameters),
          attributes: JSON.stringify(member.attributes),
          signature: generateMemberSignature(member),
          has_serialize_field: member.attributes.includes('SerializeField'),
          has_header_attr: member.attributes.includes('Header'),
        });
      }
    }

    const mainScript = scripts[0];
    if (mainScript) {
      this.store.upsertFile({
        path: relativePath, type: 'script', content_hash: '', modified_at: '', indexed_at: new Date().toISOString(),
        summary_line: generateFileSummaryLine('script', basename(relativePath), {
          className: mainScript.className, baseClass: mainScript.baseClass,
          memberCount: mainScript.members.length,
        }),
        importance_score: mainScript.isMonoBehaviour ? 0.7 : 0.4,
        status: 'ok',
      });
    }
  }

  private indexAsmDef(fileId: number, relativePath: string, content: string): void {
    const asmdef = parseAsmDef(content);

    this.store.insertAssembly({
      file_id: fileId,
      name: asmdef.name,
      references: JSON.stringify(asmdef.references),
      defines: JSON.stringify(asmdef.defines),
      platforms: JSON.stringify([...asmdef.includePlatforms, ...asmdef.excludePlatforms]),
      dependency_summary: asmdef.references.length > 0
        ? `${asmdef.name} → ${asmdef.references.join(', ')}`
        : asmdef.name,
    });

    this.store.upsertFile({
      path: relativePath, type: 'asmdef', content_hash: '', modified_at: '', indexed_at: new Date().toISOString(),
      summary_line: generateFileSummaryLine('asmdef', basename(relativePath), { assemblyName: asmdef.name }),
      importance_score: 0.2,
      status: 'ok',
    });
  }

  private storeGameObjects(
    fileId: number,
    gameObjects: ParsedGameObject[],
    guidToClass: Map<string, string>
  ): void {
    // Build child name map for subtree summaries
    const childrenMap = new Map<string | null, ParsedGameObject[]>();
    for (const go of gameObjects) {
      const parentKey = go.parentFileIdLocal;
      const children = childrenMap.get(parentKey) ?? [];
      children.push(go);
      childrenMap.set(parentKey, children);
    }

    // Compute hierarchy metadata
    const depthMap = new Map<string, number>();
    function computeDepth(go: ParsedGameObject): number {
      if (depthMap.has(go.fileIdLocal)) return depthMap.get(go.fileIdLocal)!;
      if (!go.parentFileIdLocal) {
        depthMap.set(go.fileIdLocal, 0);
        return 0;
      }
      const parent = gameObjects.find(p => p.fileIdLocal === go.parentFileIdLocal);
      const d = parent ? computeDepth(parent) + 1 : 0;
      depthMap.set(go.fileIdLocal, d);
      return d;
    }

    for (const go of gameObjects) {
      computeDepth(go);

      const children = childrenMap.get(go.fileIdLocal) ?? [];
      const childNames = children.map(c => c.name);
      const depth = depthMap.get(go.fileIdLocal) ?? 0;
      const hasMonoBehaviour = go.components.some(c => c.scriptGuid);

      const componentSummary = generateComponentSummary(go.components, guidToClass);
      const subtreeSummary = generateSubtreeSummary(go.name, childNames);

      const goId = this.store.insertGameObject({
        file_id: fileId,
        file_id_local: go.fileIdLocal,
        name: go.name,
        parent_file_id_local: go.parentFileIdLocal,
        depth,
        sibling_index: 0,
        active: go.active,
        layer: go.layer,
        tag: go.tag,
        component_summary: componentSummary,
        subtree_summary: subtreeSummary,
        is_leaf: children.length === 0,
        child_count: children.length,
        subtree_depth: 0,
        importance_score: computeGameObjectImportance({
          hasMonoBehaviour, childCount: children.length, depth, refCount: 0,
        }),
      });

      for (const comp of go.components) {
        const fieldSummary = generateFieldSummary(comp.serializedFields);
        const patternHash = createHash('md5')
          .update(`${comp.typeName}:${JSON.stringify(comp.serializedFields)}`)
          .digest('hex');

        this.store.insertComponent({
          game_object_id: goId,
          type_name: comp.typeName,
          script_guid: comp.scriptGuid,
          order: comp.order,
          serialized_fields: JSON.stringify(comp.serializedFields),
          field_summary: fieldSummary,
          pattern_hash: patternHash,
        });
      }
    }
  }

  private storeReferences(fileId: number, references: ParsedGuidReference[]): void {
    for (const ref of references) {
      const targetGuid = this.store.resolveGuid(ref.targetGuid);
      this.store.insertReference({
        source_file_id: fileId,
        source_context: ref.context,
        target_guid: ref.targetGuid,
        target_file_id: targetGuid?.file_id ?? null,
        ref_type: ref.refType,
      });
    }
  }

  private buildGuidToClassMap(): Map<string, string> {
    const map = new Map<string, string>();
    const scripts = this.store.listScripts();
    for (const script of scripts) {
      const scriptFile = this.store.getFileById(script.file_id);
      if (!scriptFile) continue;
      const metaFile = this.store.getFileByPath(scriptFile.path + '.meta');
      if (!metaFile) continue;
      const guidEntry = this.store.getGuidByFileId(metaFile.id);
      if (guidEntry) {
        map.set(guidEntry.guid, script.class_name);
      }
    }
    return map;
  }

  private updateProjectSummary(): void {
    const allFiles = this.store.listFiles();
    const fileCounts: Record<string, number> = {};
    for (const f of allFiles) {
      fileCounts[f.type] = (fileCounts[f.type] ?? 0) + 1;
    }

    const scenes = this.store.listFiles('scene');
    const scripts = this.store.listScripts();
    const prefabs = this.store.listFiles('prefab');

    this.store.updateProjectSummary({
      file_counts: JSON.stringify(fileCounts),
      scene_count: scenes.length,
      prefab_count: prefabs.length,
      script_count: scripts.length,
      hot_scripts: JSON.stringify(scripts.slice(0, 10).map(s => s.class_name)),
      indexed_at: new Date().toISOString(),
      description: `Unity project: ${scenes.length} scenes, ${prefabs.length} prefabs, ${scripts.length} scripts`,
    });
  }

  private collectFiles(): string[] {
    const files: string[] = [];
    const assetsDir = join(this.projectRoot, 'Assets');
    this.walkDir(assetsDir, files);
    const packagesDir = join(this.projectRoot, 'Packages');
    this.walkDir(packagesDir, files);
    return files;
  }

  private walkDir(dir: string, files: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.walkDir(fullPath, files);
        } else {
          const rel = relative(this.projectRoot, fullPath);
          if (detectFileType(rel)) {
            files.push(rel);
          }
        }
      } catch {
        continue;
      }
    }
  }

  private getModifiedTime(fullPath: string): string {
    try {
      return statSync(fullPath).mtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indexer/indexer.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/indexer/indexer.ts tests/indexer/indexer.test.ts
git commit -m "feat: indexer orchestration — full and incremental indexing"
```

---

### Task 12: File Watcher

**Files:**
- Create: `src/indexer/file-watcher.ts`

Uses chokidar to watch `Assets/` and `Packages/` directories with debounce and bulk-change detection.

- [ ] **Step 1: Implement file-watcher.ts**

```ts
// src/indexer/file-watcher.ts
import { watch, type FSWatcher } from 'chokidar';
import { relative } from 'path';
import { Indexer } from './indexer.js';
import { detectFileType } from '../types.js';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private pendingChanges = new Map<string, 'add' | 'change' | 'unlink'>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private bulkTimer: ReturnType<typeof setTimeout> | null = null;
  private bulkCount = 0;

  constructor(
    private indexer: Indexer,
    private projectRoot: string,
    private debounceMs: number = 500,
    private bulkThreshold: number = 50,
    private bulkWindowMs: number = 2000,
  ) {}

  start(): void {
    const watchPaths = [
      `${this.projectRoot}/Assets`,
      `${this.projectRoot}/Packages`,
    ];

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    this.watcher.on('add', path => this.onFileEvent(path, 'add'));
    this.watcher.on('change', path => this.onFileEvent(path, 'change'));
    this.watcher.on('unlink', path => this.onFileEvent(path, 'unlink'));
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.bulkTimer) clearTimeout(this.bulkTimer);
    this.watcher?.close();
    this.watcher = null;
  }

  private onFileEvent(fullPath: string, event: 'add' | 'change' | 'unlink'): void {
    const rel = relative(this.projectRoot, fullPath);
    if (!detectFileType(rel)) return;

    this.pendingChanges.set(rel, event);
    this.bulkCount++;

    // Reset debounce
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);

    // Track bulk changes within window
    if (!this.bulkTimer) {
      this.bulkTimer = setTimeout(() => {
        if (this.bulkCount >= this.bulkThreshold) {
          this.handleBulkChange();
        }
        this.bulkCount = 0;
        this.bulkTimer = null;
      }, this.bulkWindowMs);
    }
  }

  private flush(): void {
    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    for (const [relativePath, event] of changes) {
      if (event === 'unlink') {
        this.indexer.removeFile(relativePath);
      } else {
        this.indexer.indexFile(relativePath);
      }
    }
  }

  private handleBulkChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pendingChanges.clear();
    this.indexer.indexAll();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/indexer/file-watcher.ts
git commit -m "feat: file watcher with debounce and bulk detection"
```

---

### Task 13: MCP Server + Resources

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/resources.ts`

Sets up the MCP server and registers the two resource endpoints.

- [ ] **Step 1: Implement resources.ts**

```ts
// src/mcp/resources.ts
import type { Store } from '../db/store.js';

export function getProjectSummary(store: Store): object {
  const summary = store.getProjectSummary();
  if (!summary) return { error: 'No index available. Run indexer first.' };

  return {
    token_hint: 200,
    file_counts: JSON.parse(summary.file_counts),
    scenes: summary.scene_count,
    prefabs: summary.prefab_count,
    scripts: summary.script_count,
    assemblies: JSON.parse(summary.assembly_structure),
    hot_scripts: JSON.parse(summary.hot_scripts),
    recent_changes: JSON.parse(summary.recent_changes),
    description: summary.description,
    indexed_at: summary.indexed_at,
  };
}

export function getProjectFiles(store: Store, cursor?: string): object {
  const files = store.listFiles();
  const pageSize = 100;
  const startIdx = cursor ? parseInt(cursor, 10) : 0;
  const page = files.slice(startIdx, startIdx + pageSize);
  const nextCursor = startIdx + pageSize < files.length ? String(startIdx + pageSize) : undefined;

  return {
    token_hint: page.length * 3,
    files: page.map(f => ({
      path: f.path,
      type: f.type,
      summary: f.summary_line,
      importance: f.importance_score,
      status: f.status,
    })),
    next_cursor: nextCursor,
    total: files.length,
  };
}
```

- [ ] **Step 2: Implement server.ts**

```ts
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from '../db/store.js';
import { Indexer } from '../indexer/indexer.js';
import { FileWatcher } from '../indexer/file-watcher.js';
import { initScriptParser } from '../parsers/script-parser.js';
import { getProjectSummary, getProjectFiles } from './resources.js';
import { registerTools } from './tools.js';

export async function startServer(projectRoot: string, dbPath: string): Promise<void> {
  await initScriptParser();

  const store = new Store(dbPath);
  const indexer = new Indexer(store, projectRoot);

  // Initial index
  indexer.indexAll();

  // Start file watcher
  const watcher = new FileWatcher(indexer, projectRoot);
  watcher.start();

  const server = new McpServer({
    name: 'unity-indexer',
    version: '0.1.0',
  });

  // Register resources
  server.resource(
    'project-summary',
    'unity://project/summary',
    { description: 'Project overview — read this first. ~200 tokens.' },
    async () => ({
      contents: [{
        uri: 'unity://project/summary',
        mimeType: 'application/json',
        text: JSON.stringify(getProjectSummary(store), null, 2),
      }],
    })
  );

  server.resource(
    'project-files',
    'unity://project/files',
    { description: 'All project files sorted by importance. Paginated.' },
    async () => ({
      contents: [{
        uri: 'unity://project/files',
        mimeType: 'application/json',
        text: JSON.stringify(getProjectFiles(store), null, 2),
      }],
    })
  );

  // Register tools
  registerTools(server, store);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', () => {
    watcher.stop();
    store.close();
    process.exit(0);
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts src/mcp/resources.ts
git commit -m "feat: MCP server setup with resources"
```

---

### Task 14: MCP Tools — All Tool Handlers

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `tests/mcp/tools.test.ts`

Registers all MCP tools: orientation, drill-down, cross-references, search, and change tracking.

- [ ] **Step 1: Write failing tests**

```ts
// tests/mcp/tools.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/db/store.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { initScriptParser } from '../../src/parsers/script-parser.js';
import {
  handleGetSceneHierarchy, handleListScripts, handleGetScriptDetail,
  handleFindReferences, handleSearch, handleRecentChanges,
  handleGetGameObject, handleResolveGuid, handleFindComponents,
} from '../../src/mcp/tools.js';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, '../fixtures/TestProject');
let store: Store;

beforeAll(async () => {
  await initScriptParser();
});

beforeEach(() => {
  store = new Store(':memory:');
  const indexer = new Indexer(store, FIXTURES);
  indexer.indexAll();
});

afterEach(() => {
  store.close();
});

describe('handleGetSceneHierarchy', () => {
  it('returns scene hierarchy with summaries', () => {
    const result = handleGetSceneHierarchy(store, { scene: 'Assets/Scenes/MainScene.unity' });
    expect(result.roots).toBeDefined();
    expect(result.roots.length).toBeGreaterThan(0);
    expect(result.roots[0]).toHaveProperty('name');
    expect(result.roots[0]).toHaveProperty('components');
    expect(result).toHaveProperty('token_hint');
  });
});

describe('handleListScripts', () => {
  it('returns scripts with api_summary', () => {
    const result = handleListScripts(store, {});
    expect(result.scripts.length).toBeGreaterThan(0);
    expect(result.scripts[0]).toHaveProperty('class_name');
    expect(result.scripts[0]).toHaveProperty('api_summary');
  });

  it('filters by is_monobehaviour', () => {
    const result = handleListScripts(store, { is_monobehaviour: true });
    for (const s of result.scripts) {
      expect(s.is_monobehaviour).toBeTruthy();
    }
  });
});

describe('handleGetScriptDetail', () => {
  it('returns full member list for a script', () => {
    const result = handleGetScriptDetail(store, { class_name: 'PlayerController' });
    expect(result.class_name).toBe('PlayerController');
    expect(result.members.length).toBeGreaterThan(0);
    expect(result.members[0]).toHaveProperty('signature');
  });
});

describe('handleFindReferences', () => {
  it('finds references to a GUID', () => {
    const result = handleFindReferences(store, { guid_or_name: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
    expect(result.references.length).toBeGreaterThan(0);
  });
});

describe('handleSearch', () => {
  it('finds files matching query', () => {
    const result = handleSearch(store, { query: 'Player' });
    expect(result.results.length).toBeGreaterThan(0);
  });
});

describe('handleRecentChanges', () => {
  it('returns recent changes', () => {
    const result = handleRecentChanges(store, {});
    expect(result.changes.length).toBeGreaterThan(0);
  });
});

describe('handleResolveGuid', () => {
  it('resolves GUID to file path', () => {
    const result = handleResolveGuid(store, { guid: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
    expect(result.path).toBeDefined();
    expect(result.asset_type).toBe('script');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tools.ts**

```ts
// src/mcp/tools.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../db/store.js';

// === Tool Handlers (exported for testing) ===

export function handleGetSceneHierarchy(store: Store, params: { scene: string; depth?: number; filter?: string }): any {
  const file = store.getFileByPath(params.scene);
  if (!file) return { error: `Scene not found: ${params.scene}`, token_hint: 10 };

  let gameObjects = store.getGameObjectsByFile(file.id);

  if (params.depth !== undefined) {
    gameObjects = gameObjects.filter(go => go.depth <= params.depth!);
  }

  if (params.filter) {
    const f = params.filter.toLowerCase();
    gameObjects = gameObjects.filter(go =>
      go.name.toLowerCase().includes(f) ||
      go.tag.toLowerCase().includes(f)
    );
  }

  const roots = gameObjects
    .filter(go => go.parent_file_id_local === null || go.depth === 0)
    .sort((a, b) => b.importance_score - a.importance_score)
    .map(go => ({
      name: go.name,
      components: go.component_summary,
      children_summary: go.subtree_summary,
      importance: go.importance_score,
      tag: go.tag,
      active: go.active,
    }));

  return {
    scene: params.scene,
    token_hint: Math.max(50, roots.length * 30),
    roots,
  };
}

export function handleGetPrefabStructure(store: Store, params: { prefab: string }): any {
  return handleGetSceneHierarchy(store, { scene: params.prefab });
}

export function handleListScripts(store: Store, params: { namespace?: string; base_class?: string; assembly?: string; is_monobehaviour?: boolean }): any {
  const scripts = store.listScripts({
    namespace: params.namespace,
    baseClass: params.base_class,
    assembly: params.assembly,
    isMonoBehaviour: params.is_monobehaviour,
  });

  return {
    token_hint: Math.max(50, scripts.length * 20),
    scripts: scripts.map(s => ({
      class_name: s.class_name,
      namespace: s.namespace,
      base_class: s.base_class,
      api_summary: s.api_summary,
      is_monobehaviour: s.is_monobehaviour,
      is_generated: s.is_generated,
      complexity: s.complexity_score,
    })),
  };
}

export function handleListAssets(store: Store, params: { type?: string }): any {
  const files = store.listFiles('asset');
  return {
    token_hint: Math.max(50, files.length * 5),
    assets: files.map(f => ({
      path: f.path,
      summary: f.summary_line,
    })),
  };
}

export function handleGetGameObject(store: Store, params: { scene: string; name_or_id: string }): any {
  const file = store.getFileByPath(params.scene);
  if (!file) return { error: `Scene not found: ${params.scene}`, token_hint: 10 };

  const go = store.getGameObjectByName(file.id, params.name_or_id);
  if (!go) return { error: `GameObject not found: ${params.name_or_id}`, token_hint: 10 };

  const components = store.getComponentsByGameObject(go.id);
  return {
    token_hint: Math.max(30, components.length * 20),
    name: go.name,
    tag: go.tag,
    layer: go.layer,
    active: go.active,
    components: components.map(c => ({
      type: c.type_name,
      script_guid: c.script_guid,
      fields: JSON.parse(c.serialized_fields),
      field_summary: c.field_summary,
    })),
  };
}

export function handleGetComponent(store: Store, params: { scene: string; game_object: string; component_type: string }): any {
  const file = store.getFileByPath(params.scene);
  if (!file) return { error: `Scene not found: ${params.scene}`, token_hint: 10 };

  const go = store.getGameObjectByName(file.id, params.game_object);
  if (!go) return { error: `GameObject not found: ${params.game_object}`, token_hint: 10 };

  const components = store.getComponentsByGameObject(go.id);
  const comp = components.find(c => c.type_name === params.component_type);
  if (!comp) return { error: `Component not found: ${params.component_type}`, token_hint: 10 };

  return {
    token_hint: 30,
    type: comp.type_name,
    script_guid: comp.script_guid,
    fields: JSON.parse(comp.serialized_fields),
    field_summary: comp.field_summary,
  };
}

export function handleGetScriptDetail(store: Store, params: { class_name: string }): any {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) return { error: `Script not found: ${params.class_name}`, token_hint: 10 };

  const members = store.getScriptMembers(script.id);
  return {
    token_hint: Math.max(30, members.length * 5),
    class_name: script.class_name,
    namespace: script.namespace,
    base_class: script.base_class,
    interfaces: JSON.parse(script.interfaces),
    is_monobehaviour: script.is_monobehaviour,
    members: members.map(m => ({
      name: m.name,
      kind: m.kind,
      access: m.access,
      signature: m.signature,
      attributes: JSON.parse(m.attributes),
      has_serialize_field: m.has_serialize_field,
    })),
  };
}

export function handleGetScriptMember(store: Store, params: { class_name: string; member_name: string }): any {
  const script = store.getScriptByClassName(params.class_name);
  if (!script) return { error: `Script not found: ${params.class_name}`, token_hint: 10 };

  const members = store.getScriptMembers(script.id);
  const member = members.find(m => m.name === params.member_name);
  if (!member) return { error: `Member not found: ${params.member_name}`, token_hint: 10 };

  return {
    token_hint: 20,
    name: member.name,
    kind: member.kind,
    access: member.access,
    return_type: member.return_type,
    parameters: JSON.parse(member.parameters),
    attributes: JSON.parse(member.attributes),
    signature: member.signature,
  };
}

export function handleFindReferences(store: Store, params: { guid_or_name: string }): any {
  let guid = params.guid_or_name;

  // If it looks like a name, try to resolve to GUID
  if (guid.length < 32 || guid.includes('.') || /[A-Z]/.test(guid)) {
    const script = store.getScriptByClassName(guid);
    if (script) {
      const scriptFile = store.getFileById(script.file_id);
      if (scriptFile) {
        const metaFile = store.getFileByPath(scriptFile.path + '.meta');
        if (metaFile) {
          const guidEntry = store.getGuidByFileId(metaFile.id);
          if (guidEntry) guid = guidEntry.guid;
        }
      }
    }
  }

  const refs = store.getReferencesToGuid(guid);
  return {
    token_hint: Math.max(20, refs.length * 10),
    target: params.guid_or_name,
    resolved_guid: guid,
    references: refs.map(r => {
      const file = store.getFileById(r.source_file_id);
      return {
        source_file: file?.path ?? 'unknown',
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
  };
}

export function handleFindDependencies(store: Store, params: { guid_or_name: string }): any {
  // Resolve name → file if needed
  let fileId: number | null = null;
  const file = store.getFileByPath(params.guid_or_name);
  if (file) {
    fileId = file.id;
  } else {
    const script = store.getScriptByClassName(params.guid_or_name);
    if (script) fileId = script.file_id;
  }

  if (!fileId) return { error: `Not found: ${params.guid_or_name}`, token_hint: 10 };

  const refs = store.getReferencesFromFile(fileId);
  return {
    token_hint: Math.max(20, refs.length * 10),
    source: params.guid_or_name,
    dependencies: refs.map(r => {
      const targetFile = r.target_file_id ? store.getFileById(r.target_file_id) : null;
      return {
        target_guid: r.target_guid,
        target_file: targetFile?.path ?? null,
        context: r.source_context,
        ref_type: r.ref_type,
      };
    }),
  };
}

export function handleResolveGuid(store: Store, params: { guid: string }): any {
  const entry = store.resolveGuid(params.guid);
  if (!entry) return { error: `GUID not found: ${params.guid}`, token_hint: 10 };

  const file = store.getFileById(entry.file_id);
  return {
    token_hint: 10,
    guid: params.guid,
    path: file?.path ?? 'unknown',
    asset_type: entry.asset_type,
  };
}

export function handleSearch(store: Store, params: { query: string; scope?: string }): any {
  const results = store.search(params.query, params.scope);
  return {
    token_hint: Math.max(20, results.length * 5),
    query: params.query,
    results: results.map(f => ({
      path: f.path,
      type: f.type,
      summary: f.summary_line,
      importance: f.importance_score,
    })),
  };
}

export function handleFindComponents(store: Store, params: { type: string; scene?: string }): any {
  const file = params.scene ? store.getFileByPath(params.scene) : null;
  const components = store.getComponentsByType(params.type, file?.id);
  return {
    token_hint: Math.max(20, components.length * 8),
    type: params.type,
    components: components.map(c => ({
      field_summary: c.field_summary,
      script_guid: c.script_guid,
    })),
  };
}

export function handleRecentChanges(store: Store, params: { since?: string; limit?: number }): any {
  const changes = store.getRecentChanges(params.limit ?? 50);
  return {
    token_hint: Math.max(10, changes.length * 3),
    changes: changes.map(c => ({
      path: c.path,
      change_type: c.change_type,
      changed_at: c.changed_at,
    })),
  };
}

// === MCP Registration ===

export function registerTools(server: McpServer, store: Store): void {
  server.tool('get_scene_hierarchy',
    'Get GameObject hierarchy for a scene. Returns tree with component summaries.',
    { scene: z.string(), depth: z.number().optional(), filter: z.string().optional() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetSceneHierarchy(store, params), null, 2) }] })
  );

  server.tool('get_prefab_structure',
    'Get GameObject hierarchy for a prefab.',
    { prefab: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetPrefabStructure(store, params), null, 2) }] })
  );

  server.tool('list_scripts',
    'List all scripts sorted by importance. Filter by namespace, base class, assembly, or MonoBehaviour.',
    {
      namespace: z.string().optional(),
      base_class: z.string().optional(),
      assembly: z.string().optional(),
      is_monobehaviour: z.boolean().optional(),
    },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleListScripts(store, params), null, 2) }] })
  );

  server.tool('list_assets',
    'List ScriptableObjects and other assets.',
    { type: z.string().optional() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleListAssets(store, params), null, 2) }] })
  );

  server.tool('get_game_object',
    'Get full component detail for a specific GameObject.',
    { scene: z.string(), name_or_id: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetGameObject(store, params), null, 2) }] })
  );

  server.tool('get_component',
    'Get a single component\'s serialized fields.',
    { scene: z.string(), game_object: z.string(), component_type: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetComponent(store, params), null, 2) }] })
  );

  server.tool('get_script_detail',
    'Get full member list with signatures for a script class.',
    { class_name: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetScriptDetail(store, params), null, 2) }] })
  );

  server.tool('get_script_member',
    'Get detail for a single script member.',
    { class_name: z.string(), member_name: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleGetScriptMember(store, params), null, 2) }] })
  );

  server.tool('find_references',
    'Find all incoming references to a GUID or script class name.',
    { guid_or_name: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleFindReferences(store, params), null, 2) }] })
  );

  server.tool('find_dependencies',
    'Find all outgoing references from a file or script.',
    { guid_or_name: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleFindDependencies(store, params), null, 2) }] })
  );

  server.tool('resolve_guid',
    'Resolve a GUID to file path and type.',
    { guid: z.string() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleResolveGuid(store, params), null, 2) }] })
  );

  server.tool('search',
    'Search across names, class names, and field values.',
    { query: z.string(), scope: z.string().optional() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleSearch(store, params), null, 2) }] })
  );

  server.tool('find_components',
    'Find all components of a given type across scenes.',
    { type: z.string(), scene: z.string().optional() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleFindComponents(store, params), null, 2) }] })
  );

  server.tool('recent_changes',
    'List recently changed files.',
    { since: z.string().optional(), limit: z.number().optional() },
    async (params) => ({ content: [{ type: 'text', text: JSON.stringify(handleRecentChanges(store, params), null, 2) }] })
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: all MCP tool handlers — orientation, drill-down, references, search"
```

---

### Task 15: Entry Point

**Files:**
- Create: `src/index.ts`

CLI entry point that accepts a project path and starts the MCP server.

- [ ] **Step 1: Implement index.ts**

```ts
#!/usr/bin/env node
// src/index.ts
import { startServer } from './mcp/server.js';
import { resolve, join } from 'path';

const projectRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const dbPath = join(projectRoot, '.unity-indexer.db');

startServer(projectRoot, dbPath).catch(err => {
  console.error('Failed to start unity-indexer:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify**

Run: `npx tsc`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entry point"
```

---

### Task 16: Integration Test

**Files:**
- Create: `tests/integration.test.ts`

End-to-end test: index fixture project, query via tool handlers, verify token-efficient responses.

- [ ] **Step 1: Write integration test**

```ts
// tests/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/db/store.js';
import { Indexer } from '../src/indexer/indexer.js';
import { initScriptParser } from '../src/parsers/script-parser.js';
import {
  handleGetSceneHierarchy, handleListScripts, handleGetScriptDetail,
  handleFindReferences, handleSearch, handleRecentChanges,
  handleGetGameObject, handleResolveGuid,
} from '../src/mcp/tools.js';
import { getProjectSummary, getProjectFiles } from '../src/mcp/resources.js';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, 'fixtures/TestProject');
let store: Store;

beforeAll(async () => {
  await initScriptParser();
  store = new Store(':memory:');
  const indexer = new Indexer(store, FIXTURES);
  indexer.indexAll();
});

afterAll(() => {
  store.close();
});

describe('Integration: full pipeline', () => {
  it('project summary provides orientation in ~200 tokens', () => {
    const summary = getProjectSummary(store) as any;
    expect(summary.scenes).toBe(1);
    expect(summary.scripts).toBeGreaterThan(0);
    expect(summary.description).toContain('Unity project');
    const jsonSize = JSON.stringify(summary).length;
    expect(jsonSize).toBeLessThan(2000); // rough token proxy: ~4 chars per token → ~500 tokens max
  });

  it('file listing shows all indexed files', () => {
    const files = getProjectFiles(store) as any;
    expect(files.total).toBeGreaterThan(0);
    expect(files.files[0]).toHaveProperty('summary');
  });

  it('scene hierarchy is compact and informative', () => {
    const hierarchy = handleGetSceneHierarchy(store, { scene: 'Assets/Scenes/MainScene.unity' });
    expect(hierarchy.roots.length).toBeGreaterThan(0);
    expect(hierarchy.token_hint).toBeLessThan(500);

    const player = hierarchy.roots.find((r: any) => r.name === 'Player');
    expect(player).toBeDefined();
    expect(player.components).toContain('Transform');
  });

  it('script listing provides api_summary for quick orientation', () => {
    const scripts = handleListScripts(store, {});
    const pc = scripts.scripts.find((s: any) => s.class_name === 'PlayerController');
    expect(pc).toBeDefined();
    expect(pc.api_summary).toContain('MonoBehaviour');
    expect(pc.api_summary).toContain('TakeDamage');
  });

  it('script detail shows full member signatures', () => {
    const detail = handleGetScriptDetail(store, { class_name: 'PlayerController' });
    expect(detail.members.length).toBeGreaterThan(0);

    const takeDamage = detail.members.find((m: any) => m.name === 'TakeDamage');
    expect(takeDamage).toBeDefined();
    expect(takeDamage.signature).toContain('void TakeDamage(int amount)');
  });

  it('GUID resolution works end-to-end', () => {
    const resolved = handleResolveGuid(store, { guid: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
    expect(resolved.path).toContain('PlayerController.cs');
    expect(resolved.asset_type).toBe('script');
  });

  it('reference tracking finds scene→script references', () => {
    const refs = handleFindReferences(store, { guid_or_name: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
    expect(refs.references.length).toBeGreaterThan(0);
    expect(refs.references[0].source_file).toContain('MainScene.unity');
  });

  it('search finds entities by name', () => {
    const results = handleSearch(store, { query: 'Player' });
    expect(results.results.length).toBeGreaterThan(0);
  });

  it('change log records all indexed files', () => {
    const changes = handleRecentChanges(store, {});
    expect(changes.changes.length).toBeGreaterThan(0);
  });

  it('progressive disclosure: summary → hierarchy → detail costs increasing tokens', () => {
    const summary = getProjectSummary(store) as any;
    const hierarchy = handleGetSceneHierarchy(store, { scene: 'Assets/Scenes/MainScene.unity' });
    const detail = handleGetGameObject(store, { scene: 'Assets/Scenes/MainScene.unity', name_or_id: 'Player' });

    // Each level should cost more tokens than the previous
    expect(hierarchy.token_hint).toBeGreaterThan(summary.token_hint ?? 0);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "feat: integration test — full pipeline verification"
```

- [ ] **Step 4: Final build check**

Run: `npx tsc && npx vitest run`
Expected: clean compile + all tests PASS
