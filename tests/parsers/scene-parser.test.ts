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
    expect(mb.serializedFields).not.toHaveProperty('m_Enabled');
    expect(mb.serializedFields).not.toHaveProperty('m_ObjectHideFlags');
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
