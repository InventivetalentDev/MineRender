import { createHash } from "node:crypto";
import { ApiError } from "./problem.js";
import type { RenderRequest } from "./request.js";

export interface RenderResource {
    id: string;
    status: "completed";
    createdAt: string;
    expiresAt: string;
    image: { href: string; mediaType: "image/png"; width: number; height: number };
}

export interface RenderRecord {
    resource: RenderResource;
    png: Buffer;
    etag: string;
    expires: number;
}

export interface StoreOptions {
    render: (request: RenderRequest, signal: AbortSignal) => Promise<Buffer>;
    concurrency: number;
    maxQueue: number;
    timeoutMs: number;
    cacheBytes: number;
    cacheTtlMs: number;
}

interface Job {
    id: string;
    request: RenderRequest;
    controller: AbortController;
    promise: Promise<RenderRecord>;
    resolve: (record: RenderRecord) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    waiters: number;
    settled: boolean;
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export class RenderStore {
    private readonly records = new Map<string, RenderRecord>();
    private readonly pending = new Map<string, Job>();
    private readonly queue: Job[] = [];
    private readonly running = new Set<Promise<void>>();
    private readonly activeJobs = new Set<Job>();
    private bytes = 0;
    private closed = false;

    constructor(private readonly options: StoreOptions) {}

    public get(id: string): RenderRecord | undefined {
        const record = this.records.get(id);
        if (!record) return undefined;
        this.records.delete(id);
        if (record.expires <= Date.now()) {
            this.bytes -= record.png.length;
            return undefined;
        }
        this.records.set(id, record);
        return record;
    }

    public async submit(request: RenderRequest, signal: AbortSignal): Promise<{ record: RenderRecord; created: boolean }> {
        if (this.closed) throw new ApiError(503, "The rendering service is shutting down.");
        signal.throwIfAborted();
        const id = createHash("sha256").update(canonical(request)).digest("hex");
        const cached = this.get(id);
        if (cached) return { record: cached, created: false };
        let job = this.pending.get(id);
        const created = !job;
        if (!job) {
            if (this.activeJobs.size >= this.options.concurrency && this.queue.length >= this.options.maxQueue) {
                throw new ApiError(503, "The render queue is full. Try again later.");
            }
            let resolve!: Job["resolve"], reject!: Job["reject"];
            const promise = new Promise<RenderRecord>((accept, fail) => { resolve = accept; reject = fail; });
            const controller = new AbortController();
            job = { id, request, controller, promise, resolve, reject, waiters: 0, settled: false,
                timer: setTimeout(() => controller.abort(new ApiError(504, "The render exceeded its time limit.")), this.options.timeoutMs) };
            const queued = job;
            controller.signal.addEventListener("abort", () => {
                const index = this.queue.indexOf(queued);
                if (index !== -1) this.queue.splice(index, 1);
                this.finish(queued, undefined, controller.signal.reason);
            }, { once: true });
            this.pending.set(id, job);
            this.queue.push(job);
        }
        job.waiters++;
        const waiting = job;
        const result = new Promise<RenderRecord>((resolve, reject) => {
            const aborted = () => reject(signal.reason);
            signal.addEventListener("abort", aborted, { once: true });
            waiting.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
        });
        this.pump();
        try {
            return { record: await result, created };
        } finally {
            waiting.waiters--;
            if (!waiting.waiters && !waiting.settled) {
                waiting.controller.abort(new ApiError(499, "The requesting client disconnected."));
            }
        }
    }

    private pump(): void {
        while (!this.closed && this.activeJobs.size < this.options.concurrency && this.queue.length) {
            const job = this.queue.shift()!;
            this.activeJobs.add(job);
            const execution = this.execute(job).finally(() => {
                this.activeJobs.delete(job);
                this.running.delete(execution);
                this.pump();
            });
            this.running.add(execution);
        }
    }

    private async execute(job: Job): Promise<void> {
        try {
            const png = await this.options.render(job.request, job.controller.signal);
            if (job.settled) return;
            if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
                throw new ApiError(502, "The renderer did not return a PNG image.");
            }
            if (png.length > this.options.cacheBytes) throw new ApiError(503, "The image exceeds the render cache capacity.");
            const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
            if (!width || !height || width > job.request.output.width || height > job.request.output.height) {
                throw new ApiError(502, "The renderer returned invalid image dimensions.");
            }
            const now = Date.now(), expires = now + this.options.cacheTtlMs;
            const record: RenderRecord = {
                png, expires, etag: `"${createHash("sha256").update(png).digest("hex")}"`,
                resource: { id: job.id, status: "completed", createdAt: new Date(now).toISOString(),
                    expiresAt: new Date(expires).toISOString(), image: { href: `/v1/renders/${job.id}/image`,
                        mediaType: "image/png", width, height } }
            };
            for (const [id, entry] of this.records) {
                if (entry.expires <= now) this.remove(id);
            }
            while (this.records.size && (this.bytes + png.length > this.options.cacheBytes || this.records.size >= 256)) {
                this.remove(this.records.keys().next().value!);
            }
            this.records.set(job.id, record);
            this.bytes += png.length;
            this.finish(job, record);
        } catch (error) {
            this.finish(job, undefined, error instanceof ApiError ? error : new ApiError(502, "The scene could not be rendered."));
        }
    }

    private remove(id: string): void {
        const record = this.records.get(id);
        if (record) this.bytes -= record.png.length;
        this.records.delete(id);
    }

    private finish(job: Job, record?: RenderRecord, error?: unknown): void {
        if (job.settled) return;
        job.settled = true;
        clearTimeout(job.timer);
        this.pending.delete(job.id);
        if (record) job.resolve(record);
        else job.reject(error);
    }

    public async close(): Promise<void> {
        this.closed = true;
        for (const job of this.pending.values()) {
            job.controller.abort(new ApiError(503, "The rendering service is shutting down."));
        }
        await Promise.allSettled(this.running);
        this.records.clear();
        this.bytes = 0;
    }
}
