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

  indexer.indexAll();

  const watcher = new FileWatcher(indexer, projectRoot);
  watcher.start();

  const server = new McpServer({
    name: 'unity-indexer',
    version: '0.1.0',
  });

  server.resource(
    'project-summary',
    'unity://project/summary',
    { description: 'Project overview — read this first. ~200 tokens.' },
    async () => ({
      contents: [
        {
          uri: 'unity://project/summary',
          mimeType: 'application/json',
          text: JSON.stringify(getProjectSummary(store), null, 2),
        },
      ],
    }),
  );

  server.resource(
    'project-files',
    'unity://project/files',
    { description: 'All project files sorted by importance. Paginated.' },
    async () => ({
      contents: [
        {
          uri: 'unity://project/files',
          mimeType: 'application/json',
          text: JSON.stringify(getProjectFiles(store), null, 2),
        },
      ],
    }),
  );

  registerTools(server, store);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', () => {
    watcher.stop();
    store.close();
    process.exit(0);
  });
}
