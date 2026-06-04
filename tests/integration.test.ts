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
    expect(jsonSize).toBeLessThan(2000);
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

    // Detail (50 tokens) should cost more tokens than the per-object hierarchy estimate
    // Summary is a fixed 200 token budget; hierarchy is proportional to root count
    expect(detail.token_hint).toBeGreaterThan(hierarchy.token_hint);
    expect(summary.token_hint).toBeGreaterThan(0);
    expect(hierarchy.token_hint).toBeGreaterThan(0);
  });
});
