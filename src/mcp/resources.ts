import type { Store } from "../db/store.js";

export function getProjectSummary(store: Store): object {
  const summary = store.getProjectSummary();

  return {
    token_hint: 200,
    file_counts: JSON.parse(summary.file_counts) as unknown,
    scenes: summary.scene_count,
    prefabs: summary.prefab_count,
    scripts: summary.script_count,
    assemblies: JSON.parse(summary.assembly_structure) as unknown,
    hot_scripts: JSON.parse(summary.hot_scripts) as unknown,
    recent_changes: JSON.parse(summary.recent_changes) as unknown,
    description: summary.description,
    indexed_at: summary.indexed_at,
  };
}

export function getProjectFiles(store: Store, cursor?: string): object {
  const files = store.listFiles();
  const pageSize = 100;
  const startIdx = cursor !== undefined ? parseInt(cursor, 10) : 0;
  const page = files.slice(startIdx, startIdx + pageSize);
  const nextCursor = startIdx + pageSize < files.length ? String(startIdx + pageSize) : undefined;

  return {
    token_hint: page.length * 3,
    files: page.map((f) => ({
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
