import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateFixture } from "./generate-fixture.js";
import { Store } from "../../src/db/store.js";
import { Indexer } from "../../src/indexer/indexer.js";
import { initScriptParser } from "../../src/parsers/script-parser.js";
import { Benchmark } from "../../src/benchmark.js";

async function run() {
  const preset = process.argv[2] ?? "small";
  console.log(`Generating ${preset} fixture...`);

  const tmpDir = mkdtempSync(join(tmpdir(), "unity-bench-"));
  const fixtureDir = join(tmpDir, "project");
  const dbPath = join(tmpDir, "bench.db");

  try {
    generateFixture(fixtureDir, preset);
    await initScriptParser();

    const bench = new Benchmark();
    bench.start();

    const store = new Store(dbPath);
    const indexer = new Indexer(store, fixtureDir, bench);

    indexer.indexAll();

    const files = store.listFiles();
    const result = bench.finish(dbPath, files.length);

    console.log(JSON.stringify(result, null, 2));
    store.close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
