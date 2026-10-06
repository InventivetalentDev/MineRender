import { JobQueue } from "jobqu";

export class BatchedExecutor {

    public readonly interval: number;
    public readonly batch: number;

    private readonly queue: JobQueue<Task, unknown>;

    constructor(interval: number = 1, batch: number = 30) {
        if (!Number.isFinite(interval) || interval < 0) throw new RangeError("Batch interval must be finite and nonnegative");
        if (!Number.isInteger(batch) || batch < 1) throw new RangeError("Batch size must be a positive integer");
        this.interval = interval;
        this.batch = batch;
        this.queue = new JobQueue(async task => task(), { interval, maxPerRun: batch, maxActive: batch });
    }

    public submit<T>(task: Task<T>): Promise<T> {
        // Each submission needs its own key because JobQueue deduplicates keys.
        return this.queue.add(() => task()) as Promise<T>;
    }

    public stop(): void {
        this.queue.end();
    }

}

type Task<T = unknown> = () => T | Promise<T>;
