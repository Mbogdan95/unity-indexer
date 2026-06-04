import { performance } from "perf_hooks";
import { statSync } from "fs";

export interface PhaseResult {
  name: string;
  ms: number;
}

export interface BenchmarkResult {
  indexing_ms: number;
  db_size_bytes: number;
  peak_memory_bytes: number;
  file_count: number;
  files_per_second: number;
  phases: PhaseResult[];
}

export class Benchmark {
  private phases: PhaseResult[] = [];
  private startTime = 0;
  private peakMemory = 0;

  start(): void {
    this.startTime = performance.now();
    this.peakMemory = process.memoryUsage().heapUsed;
  }

  startPhase(name: string): () => void {
    const phaseStart = performance.now();
    return () => {
      this.phases.push({ name, ms: Math.round(performance.now() - phaseStart) });
      const mem = process.memoryUsage().heapUsed;
      if (mem > this.peakMemory) this.peakMemory = mem;
    };
  }

  finish(dbPath: string, fileCount: number): BenchmarkResult {
    const totalMs = Math.round(performance.now() - this.startTime);
    let dbSize = 0;
    try {
      dbSize = statSync(dbPath).size;
    } catch {
      /* in-memory DB */
    }

    return {
      indexing_ms: totalMs,
      db_size_bytes: dbSize,
      peak_memory_bytes: this.peakMemory,
      file_count: fileCount,
      files_per_second: fileCount > 0 ? Math.round(fileCount / (totalMs / 1000)) : 0,
      phases: this.phases,
    };
  }
}
