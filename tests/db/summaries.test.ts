import { describe, it, expect } from 'vitest';
import type { ParsedComponent, ParsedScript, ParsedScriptMember } from '../../src/types.js';
import {
  generateComponentSummary,
  generateSubtreeSummary,
  generateFieldSummary,
  generateApiSummary,
  generateMemberSignature,
  generateFileSummaryLine,
  computeGameObjectImportance,
  computeFileImportance,
} from '../../src/db/summaries.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComponent(overrides: Partial<ParsedComponent> = {}): ParsedComponent {
  return {
    fileIdLocal: '100',
    typeName: 'Transform',
    scriptGuid: null,
    order: 0,
    serializedFields: {},
    gameObjectFileId: '1',
    ...overrides,
  };
}

function makeMember(overrides: Partial<ParsedScriptMember> = {}): ParsedScriptMember {
  return {
    name: 'MyMethod',
    kind: 'method',
    access: 'public',
    returnType: 'void',
    parameters: [],
    attributes: [],
    isStatic: false,
    ...overrides,
  };
}

function makeScript(overrides: Partial<ParsedScript> = {}): ParsedScript {
  return {
    className: 'PlayerController',
    kind: 'class',
    namespace: '',
    baseClass: 'MonoBehaviour',
    interfaces: [],
    members: [],
    isMonoBehaviour: true,
    isEditorScript: false,
    isScriptableObject: false,
    isGenerated: false,
    loc: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateComponentSummary
// ---------------------------------------------------------------------------

describe('generateComponentSummary', () => {
  it('lists component type names joined by comma', () => {
    const comps = [
      makeComponent({ typeName: 'Transform' }),
      makeComponent({ typeName: 'Camera' }),
      makeComponent({ typeName: 'AudioSource' }),
    ];
    const result = generateComponentSummary(comps, new Map());
    expect(result).toBe('Transform, Camera, AudioSource');
  });

  it('resolves MonoBehaviour to script class name via guidToClassName', () => {
    const comps = [
      makeComponent({ typeName: 'Transform' }),
      makeComponent({ typeName: 'MonoBehaviour', scriptGuid: 'abc123' }),
    ];
    const map = new Map([['abc123', 'PlayerController']]);
    const result = generateComponentSummary(comps, map);
    expect(result).toBe('Transform, PlayerController');
  });

  it('falls back to MonoBehaviour when guid not in map', () => {
    const comps = [
      makeComponent({ typeName: 'MonoBehaviour', scriptGuid: 'unknown-guid' }),
    ];
    const result = generateComponentSummary(comps, new Map());
    expect(result).toBe('MonoBehaviour');
  });

  it('keeps MonoBehaviour when scriptGuid is null', () => {
    const comps = [makeComponent({ typeName: 'MonoBehaviour', scriptGuid: null })];
    const result = generateComponentSummary(comps, new Map());
    expect(result).toBe('MonoBehaviour');
  });

  it('returns empty string for empty component list', () => {
    expect(generateComponentSummary([], new Map())).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateSubtreeSummary
// ---------------------------------------------------------------------------

describe('generateSubtreeSummary', () => {
  it('returns just the name for a leaf node', () => {
    expect(generateSubtreeSummary('Player', [])).toBe('Player');
  });

  it('includes children count and names', () => {
    expect(generateSubtreeSummary('Root', ['A', 'B', 'C'])).toBe(
      'Root [3 children: A, B, C]',
    );
  });

  it('truncates long child lists at 5 and shows +N more', () => {
    const children = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const result = generateSubtreeSummary('Root', children);
    expect(result).toBe('Root [7 children: A, B, C, D, E, ...+2 more]');
  });

  it('shows exactly 5 children without truncation marker', () => {
    const children = ['A', 'B', 'C', 'D', 'E'];
    const result = generateSubtreeSummary('Root', children);
    expect(result).toBe('Root [5 children: A, B, C, D, E]');
  });
});

// ---------------------------------------------------------------------------
// generateFieldSummary
// ---------------------------------------------------------------------------

describe('generateFieldSummary', () => {
  it('formats primitive fields as key=value', () => {
    const fields = { speed: 5, name: 'hero', enabled: true };
    const result = generateFieldSummary(fields);
    expect(result).toContain('speed=5');
    expect(result).toContain('name=hero');
    expect(result).toContain('enabled=true');
  });

  it('formats guid reference fields with resolved name', () => {
    const fields = { target: { fileID: '100', guid: 'abc123', type: 2 } };
    const guidNames = new Map([['abc123', 'EnemyPrefab']]);
    const result = generateFieldSummary(fields, guidNames);
    expect(result).toBe('target=ref:EnemyPrefab');
  });

  it('falls back to first 8 chars of guid when not in map', () => {
    const fields = { target: { fileID: '100', guid: 'abcdef1234567890', type: 2 } };
    const result = generateFieldSummary(fields, new Map());
    expect(result).toBe('target=ref:abcdef12');
  });

  it('formats non-guid objects as key={...}', () => {
    const fields = { nested: { x: 1, y: 2 } };
    const result = generateFieldSummary(fields);
    expect(result).toBe('nested={...}');
  });

  it('returns empty string for empty fields', () => {
    expect(generateFieldSummary({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateApiSummary
// ---------------------------------------------------------------------------

describe('generateApiSummary', () => {
  it('generates header with base class', () => {
    const script = makeScript();
    const result = generateApiSummary(script);
    expect(result.split('\n')[0]).toBe('PlayerController : MonoBehaviour');
  });

  it('omits base class when empty', () => {
    const script = makeScript({ baseClass: '', interfaces: [] });
    const result = generateApiSummary(script);
    expect(result.split('\n')[0]).toBe('PlayerController');
  });

  it('includes interfaces in header', () => {
    const script = makeScript({ baseClass: 'MonoBehaviour', interfaces: ['IUpdate', 'IStart'] });
    const result = generateApiSummary(script);
    expect(result.split('\n')[0]).toBe('PlayerController : MonoBehaviour, IUpdate, IStart');
  });

  it('groups fields section for serialized and public fields', () => {
    const script = makeScript({
      members: [
        makeMember({
          name: 'speed',
          kind: 'field',
          access: 'private',
          returnType: 'float',
          attributes: ['SerializeField'],
        }),
        makeMember({
          name: 'health',
          kind: 'field',
          access: 'public',
          returnType: 'int',
          attributes: [],
        }),
      ],
    });
    const result = generateApiSummary(script);
    expect(result).toContain('fields:');
    expect(result).toContain('speed(float)');
    expect(result).toContain('health(int)');
    expect(result).toContain('[SerializeField]');
  });

  it('groups methods section', () => {
    const script = makeScript({
      members: [
        makeMember({
          name: 'Start',
          kind: 'method',
          access: 'private',
          returnType: 'void',
          parameters: [],
        }),
        makeMember({
          name: 'Move',
          kind: 'method',
          access: 'public',
          returnType: 'void',
          parameters: [{ name: 'dir', type: 'Vector3' }],
        }),
      ],
    });
    const result = generateApiSummary(script);
    expect(result).toContain('methods:');
    expect(result).toContain('Move(Vector3)');
  });

  it('groups properties section', () => {
    const script = makeScript({
      members: [
        makeMember({ name: 'IsAlive', kind: 'property', access: 'public', returnType: 'bool' }),
      ],
    });
    const result = generateApiSummary(script);
    expect(result).toContain('properties:');
    expect(result).toContain('IsAlive(bool)');
    expect(result).toContain('{get}');
  });

  it('groups events section', () => {
    const script = makeScript({
      members: [
        makeMember({ name: 'OnDeath', kind: 'event', access: 'public', returnType: 'Action' }),
      ],
    });
    const result = generateApiSummary(script);
    expect(result).toContain('events:');
    expect(result).toContain('OnDeath(Action)');
  });
});

// ---------------------------------------------------------------------------
// generateMemberSignature
// ---------------------------------------------------------------------------

describe('generateMemberSignature', () => {
  it('generates method signature', () => {
    const member = makeMember({
      name: 'Move',
      kind: 'method',
      access: 'public',
      returnType: 'void',
      parameters: [
        { name: 'direction', type: 'Vector3' },
        { name: 'speed', type: 'float' },
      ],
      isStatic: false,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('public void Move(Vector3 direction, float speed)');
  });

  it('generates field signature with attribute', () => {
    const member = makeMember({
      name: 'health',
      kind: 'field',
      access: 'private',
      returnType: 'int',
      parameters: [],
      attributes: ['SerializeField'],
      isStatic: false,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('[SerializeField] private int health');
  });

  it('generates property signature', () => {
    const member = makeMember({
      name: 'IsAlive',
      kind: 'property',
      access: 'public',
      returnType: 'bool',
      parameters: [],
      isStatic: false,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('public bool IsAlive { get; }');
  });

  it('generates static method signature', () => {
    const member = makeMember({
      name: 'Create',
      kind: 'method',
      access: 'public',
      returnType: 'PlayerController',
      isStatic: true,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('public static PlayerController Create()');
  });

  it('generates constructor signature without return type', () => {
    const member = makeMember({
      name: 'PlayerController',
      kind: 'constructor',
      access: 'public',
      returnType: '',
      parameters: [{ name: 'id', type: 'int' }],
      isStatic: false,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('public PlayerController(int id)');
  });

  it('generates event signature', () => {
    const member = makeMember({
      name: 'OnDeath',
      kind: 'event',
      access: 'public',
      returnType: 'Action',
      isStatic: false,
    });
    const result = generateMemberSignature(member);
    expect(result).toBe('public event Action OnDeath');
  });
});

// ---------------------------------------------------------------------------
// generateFileSummaryLine
// ---------------------------------------------------------------------------

describe('generateFileSummaryLine', () => {
  it('formats scene summary', () => {
    const result = generateFileSummaryLine('scene', 'Main.unity', {
      gameObjectCount: 42,
      scriptCount: 7,
    });
    expect(result).toBe('Main.unity — 42 GameObjects, 7 scripts');
  });

  it('formats prefab summary', () => {
    const result = generateFileSummaryLine('prefab', 'Player.prefab', {
      isVariant: false,
      gameObjectCount: 5,
    });
    expect(result).toBe('Player.prefab — prefab, 5 GameObjects');
  });

  it('formats prefab variant summary', () => {
    const result = generateFileSummaryLine('prefab', 'Player.prefab', {
      isVariant: true,
      gameObjectCount: 5,
    });
    expect(result).toBe('Player.prefab — prefab variant, 5 GameObjects');
  });

  it('formats script summary', () => {
    const result = generateFileSummaryLine('script', 'PlayerController.cs', {
      className: 'PlayerController',
      baseClass: 'MonoBehaviour',
      memberCount: 12,
    });
    expect(result).toBe('PlayerController.cs — PlayerController : MonoBehaviour, 12 members');
  });

  it('formats asset summary', () => {
    const result = generateFileSummaryLine('asset', 'Settings.asset', {
      typeName: 'GameSettings',
    });
    expect(result).toBe('Settings.asset — GameSettings');
  });

  it('formats asmdef summary', () => {
    const result = generateFileSummaryLine('asmdef', 'Game.asmdef', {
      assemblyName: 'Game.Core',
    });
    expect(result).toBe('Game.asmdef — assembly: Game.Core');
  });

  it('returns just file name for unknown types', () => {
    const result = generateFileSummaryLine('unknown', 'Misc.bin', {});
    expect(result).toBe('Misc.bin');
  });
});

// ---------------------------------------------------------------------------
// computeGameObjectImportance
// ---------------------------------------------------------------------------

describe('computeGameObjectImportance', () => {
  it('returns higher score with MonoBehaviour', () => {
    const withMono = computeGameObjectImportance({
      hasMonoBehaviour: true,
      childCount: 0,
      depth: 1,
      refCount: 0,
    });
    const withoutMono = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 0,
      depth: 1,
      refCount: 0,
    });
    expect(withMono).toBeGreaterThan(withoutMono);
  });

  it('returns higher score with more children', () => {
    const manyChildren = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 10,
      depth: 1,
      refCount: 0,
    });
    const fewChildren = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 1,
      depth: 1,
      refCount: 0,
    });
    expect(manyChildren).toBeGreaterThan(fewChildren);
  });

  it('gives bonus for root-level objects (depth === 0)', () => {
    const root = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 0,
      depth: 0,
      refCount: 0,
    });
    const child = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 0,
      depth: 1,
      refCount: 0,
    });
    expect(root).toBeGreaterThan(child);
  });

  it('caps at 1.0', () => {
    const score = computeGameObjectImportance({
      hasMonoBehaviour: true,
      childCount: 100,
      depth: 0,
      refCount: 100,
    });
    expect(score).toBe(1.0);
  });

  it('returns 0 for empty object', () => {
    const score = computeGameObjectImportance({
      hasMonoBehaviour: false,
      childCount: 0,
      depth: 1,
      refCount: 0,
    });
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeFileImportance
// ---------------------------------------------------------------------------

describe('computeFileImportance', () => {
  it('returns higher score with custom scripts', () => {
    const withScripts = computeFileImportance({
      incomingRefCount: 0,
      outgoingRefCount: 0,
      hasCustomScripts: true,
      changeFrequency: 0,
    });
    const withoutScripts = computeFileImportance({
      incomingRefCount: 0,
      outgoingRefCount: 0,
      hasCustomScripts: false,
      changeFrequency: 0,
    });
    expect(withScripts).toBeGreaterThan(withoutScripts);
  });

  it('returns higher score with more incoming refs', () => {
    const manyRefs = computeFileImportance({
      incomingRefCount: 20,
      outgoingRefCount: 0,
      hasCustomScripts: false,
      changeFrequency: 0,
    });
    const fewRefs = computeFileImportance({
      incomingRefCount: 1,
      outgoingRefCount: 0,
      hasCustomScripts: false,
      changeFrequency: 0,
    });
    expect(manyRefs).toBeGreaterThan(fewRefs);
  });

  it('caps at 1.0', () => {
    const score = computeFileImportance({
      incomingRefCount: 100,
      outgoingRefCount: 100,
      hasCustomScripts: true,
      changeFrequency: 100,
    });
    expect(score).toBe(1.0);
  });

  it('returns 0 for empty file', () => {
    const score = computeFileImportance({
      incomingRefCount: 0,
      outgoingRefCount: 0,
      hasCustomScripts: false,
      changeFrequency: 0,
    });
    expect(score).toBe(0);
  });
});
