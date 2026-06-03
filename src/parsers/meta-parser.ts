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
