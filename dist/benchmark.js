import { performance } from "perf_hooks";
import { statSync } from "fs";
export class Benchmark {
    phases = [];
    startTime = 0;
    peakMemory = 0;
    start() {
        this.startTime = performance.now();
        this.peakMemory = process.memoryUsage().heapUsed;
    }
    startPhase(name) {
        const phaseStart = performance.now();
        return () => {
            this.phases.push({ name, ms: Math.round(performance.now() - phaseStart) });
            const mem = process.memoryUsage().heapUsed;
            if (mem > this.peakMemory)
                this.peakMemory = mem;
        };
    }
    finish(dbPath, fileCount) {
        const totalMs = Math.round(performance.now() - this.startTime);
        let dbSize = 0;
        try {
            dbSize = statSync(dbPath).size;
        }
        catch {
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
//# sourceMappingURL=benchmark.js.map