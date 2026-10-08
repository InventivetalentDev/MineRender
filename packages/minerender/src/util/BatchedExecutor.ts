import { JobQueue } from "jobqu";

/** Runs queued tasks in bounded batches. Idle executors do not keep a timer running. */
export class BatchedExecutor {

    public readonly interval: number;
    public readonly batch: number;

    private readonly queue: JobQueue<Task, unknown>;

    /**
     * @param interval - Delay between queue runs, in milliseconds.
     * @param batch - Maximum tasks started per run and maximum tasks active at once.
     */
    constructor(interval: number = 1, batch: number = 30) {
        if (!Number.isFinite(interval) || interval < 0) throw new RangeError("Batch interval must be finite and nonnegative");
        if (!Number.isInteger(batch) || batch < 1) throw new RangeError("Batch size must be a positive integer");
        this.interval = interval;
        this.batch = batch;
        this.queue = new JobQueue(async task => task(), { interval, maxPerRun: batch, maxActive: batch });
    }

    /** Queues a task and resolves with its result, or rejects with its error. */
    public submit<T>(task: Task<T>): Promise<T> {
        // Each submission needs its own key because JobQueue deduplicates keys.
        return this.queue.add(() => task()) as Promise<T>;
    }

    /** Rejects queued and future tasks. Tasks already running are allowed to finish. */
    public stop(): void {
        this.queue.end();
    }

}

type Task<T = unknown> = () => T | Promise<T>;
