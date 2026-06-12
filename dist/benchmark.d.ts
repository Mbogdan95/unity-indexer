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
export declare class Benchmark {
    private phases;
    private startTime;
    private peakMemory;
    start(): void;
    startPhase(name: string): () => void;
    finish(dbPath: string, fileCount: number): BenchmarkResult;
}
