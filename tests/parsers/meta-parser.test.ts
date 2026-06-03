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
