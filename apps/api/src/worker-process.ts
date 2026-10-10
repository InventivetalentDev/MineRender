import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "./problem.js";
import type { RenderRequest } from "./request.js";

const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_WORKER_RENDERS = 100;

interface PoolOptions {
    assetOrigins?: string[];
    workerUrl?: URL;
}

class RenderWorker {
    public busy = false;
    public stopping = false;
    private child?: ChildProcess;
    private cwd?: string;
    private failure: unknown;
    private completed = 0;
    private cleanupStarted = false;
    private release!: () => void;
    private job?: { resolve: (png: Buffer) => void; reject: (error: unknown) => void };
    public readonly stopped = new Promise<void>(resolve => { this.release = resolve; });
    private readonly ready: Promise<void>;

    constructor(workerUrl: URL, private readonly assetOrigins: string[]) {
        this.ready = this.start(workerUrl);
    }

    private async start(workerUrl: URL): Promise<void> {
        try {
            this.cwd = await mkdtemp(join(tmpdir(), "minerender-api-"));
            if (this.stopping) return await this.finish();
            this.child = fork(workerUrl, {
                cwd: this.cwd,
                serialization: "advanced",
                stdio: ["ignore", "ignore", "ignore", "ipc"],
                execArgv: ["--max-old-space-size=512"]
            });
            this.child.on("error", () => {
                void this.stop(new ApiError(503, "The rendering process is unavailable"));
                if (!this.child?.pid) void this.finish();
            });
            this.child.once("close", () => { void this.finish(); });
            this.child.once("disconnect", () => {
                void this.stop(new ApiError(503, "The rendering process disconnected"));
            });
            this.child.on("message", message => {
                if (this.stopping) return;
                const result = message as { ok?: unknown; png?: unknown };
                const job = this.job;
                if (job && result?.ok === true && Buffer.isBuffer(result.png) && result.png.length <= MAX_PNG_BYTES) {
                    this.job = undefined;
                    job.resolve(result.png);
                } else if (job && result?.ok === false) {
                    this.job = undefined;
                    job.reject(new ApiError(502, "The scene could not be rendered. Check its assets and Minecraft version."));
                } else {
                    void this.stop(new ApiError(502, "The rendering process returned an invalid response"));
                }
            });
        } catch {
            this.failure ??= new ApiError(503, "The rendering process is unavailable");
            await this.finish();
        }
    }

    public async render(request: RenderRequest, signal: AbortSignal): Promise<Buffer> {
        await this.ready;
        const abort = () => { void this.stop(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        try {
            if (signal.aborted) abort();
            if (this.stopping) {
                await this.stopped;
                throw this.failure;
            }
            return await new Promise<Buffer>((resolve, reject) => {
                this.job = { resolve, reject };
                try {
                    this.child!.send({ request, assetOrigins: this.assetOrigins }, error => {
                        if (error) void this.stop(new ApiError(503, "The rendering process is unavailable"));
                    });
                } catch {
                    void this.stop(new ApiError(503, "The rendering process is unavailable"));
                }
            });
        } finally {
            signal.removeEventListener("abort", abort);
            if (++this.completed >= MAX_WORKER_RENDERS) await this.stop();
        }
    }

    public stop(error: unknown = new ApiError(503, "The rendering service is shutting down.")): Promise<void> {
        this.failure ??= error;
        if (!this.stopping) {
            this.stopping = true;
            this.child?.kill("SIGKILL");
        }
        return this.stopped;
    }

    private async finish(): Promise<void> {
        if (this.cleanupStarted) return;
        this.cleanupStarted = true;
        this.stopping = true;
        this.failure ??= new ApiError(503, "The rendering process stopped before producing an image");
        try {
            if (this.cwd) await rm(this.cwd, { recursive: true, force: true });
        } catch (error) {
            this.failure = error;
        } finally {
            this.job?.reject(this.failure);
            this.job = undefined;
            this.release();
        }
    }
}

/** Reuses isolated processes and their asset caches, with one render at a time per process. */
export function createRenderPool(concurrency: number, options: PoolOptions = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
    const workers = new Set<RenderWorker>();
    const workerUrl = options.workerUrl ?? new URL("./worker.js", import.meta.url);
    const assetOrigins = [...(options.assetOrigins ?? [])];
    let closing: Promise<void> | undefined;
    return {
        async render(request: RenderRequest, signal: AbortSignal): Promise<Buffer> {
            if (closing) throw new ApiError(503, "The rendering service is shutting down.");
            signal.throwIfAborted();
            let worker = [...workers].find(entry => !entry.busy && !entry.stopping);
            if (!worker) {
                if (workers.size >= concurrency) throw new ApiError(503, "The rendering processes are busy");
                worker = new RenderWorker(workerUrl, assetOrigins);
                workers.add(worker);
                const created = worker;
                void worker.stopped.then(() => workers.delete(created));
            }
            worker.busy = true;
            try { return await worker.render(request, signal); }
            finally { worker.busy = false; }
        },
        close(): Promise<void> {
            return closing ??= Promise.all([...workers].map(worker => worker.stop())).then(() => {});
        }
    };
}
