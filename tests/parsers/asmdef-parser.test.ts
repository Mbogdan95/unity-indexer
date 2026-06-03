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
