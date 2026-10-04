import { JobCancelledError, JobQueue } from "jobqu";
import { prefix } from "../util/log";

const p = prefix("Requests");

export interface RequestConfig extends RequestInit {
    url: string;
    /** Prepended to relative URLs, preserving any path in the base URL. */
    baseURL?: string;
    /** Timeout per attempt in milliseconds, including body reading. Defaults to 5000; 0 disables it. */
    timeout?: number;
    responseType?: "json" | "arraybuffer";
}

export interface RequestResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
    /** Final URL after redirects. */
    url: string;
}

export class RequestError extends Error {
    constructor(message: string, readonly response?: RequestResponse<undefined>, readonly cause?: unknown) {
        super(message);
        this.name = "RequestError";
    }
}

async function fetchRequest(config: RequestConfig, defaultBaseURL?: string): Promise<RequestResponse> {
    const { url, baseURL = defaultBaseURL, timeout = 5000, responseType = "json", signal, ...options } = config;
    const target = baseURL && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(url)
        ? `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url;
    const headers = new Headers(options.headers);
    if (typeof window === "undefined" && !headers.has("User-Agent")) {
        headers.set("User-Agent", "MineRender");
    }
    const attemptSignal = AbortSignal.any([
        ...(signal ? [signal] : []), ...(timeout === 0 ? [] : [AbortSignal.timeout(timeout)])
    ]);
    // Validate configuration before classifying Fetch TypeErrors as network failures.
    const request = new Request(target, { ...options, headers, signal: attemptSignal });
    attemptSignal.throwIfAborted();
    try {
        const response = await fetch(request);
        const result: RequestResponse<undefined> = {
            data: undefined,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            url: response.url
        };
        if (!response.ok) {
            // Release error bodies without letting cleanup hide the HTTP status.
            await response.body?.cancel().catch(() => {});
            throw new RequestError(`Request failed with status ${response.status}`, result);
        }
        const emptyBody = request.method === "HEAD" || response.status === 204 || response.status === 205;
        const data = responseType === "arraybuffer" ? await response.arrayBuffer()
            : emptyBody || response.body === null ? undefined : await response.json();
        return { ...result, data };
    } catch (error) {
        attemptSignal.throwIfAborted();
        if (/^https?:/.test(request.url) && request.redirect !== "error" && error instanceof TypeError) {
            throw new RequestError("Network request failed", undefined, error);
        }
        throw error;
    }
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
    if (!signal) return promise;
    let abort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
    });
    try {
        return await Promise.race([promise, cancelled]);
    } finally {
        signal.removeEventListener("abort", abort!);
    }
}

class RequestQueue {

    public baseURL?: string;
    private pendingRequests = 0;
    private readonly stopped = new AbortController();
    private readonly queue = new JobQueue<RequestConfig, RequestResponse>(
        request => fetchRequest(request, this.baseURL), { interval: 10, maxPerRun: 1, maxActive: 8 });

    public async request(request: RequestConfig): Promise<RequestResponse> {
        this.pendingRequests++;
        const signal = request.signal;
        try {
            for (let retries = 0; ; retries++) {
                signal?.throwIfAborted();
                try {
                    return await abortable(this.queue.add(request), signal);
                } catch (error) {
                    console.debug(p, "Request failed", error);
                    const delay = this.retryDelay(error, request, retries);
                    if (delay === undefined) {
                        throw error;
                    }
                    await this.waitForRetry(delay, signal);
                }
            }
        } finally {
            if (signal?.aborted) {
                this.queue.remove(request);
            }
            this.pendingRequests--;
        }
    }

    private retryDelay(error: unknown, request: RequestConfig, retries: number): number | undefined {
        if (this.stopped.signal.aborted || retries >= 3 ||
            (request.method ?? "get").toLowerCase() !== "get" || request.signal?.aborted) {
            return undefined;
        }
        if (error instanceof RequestError) {
            const status = error.response?.status;
            if (status !== undefined && status !== 408 && status !== 429 && !(status >= 500 && status < 600)) return undefined;
        } else if (!(error instanceof DOMException && error.name === "TimeoutError")) {
            return undefined;
        }

        let delay = 100 * (2 ** retries);
        const retryAfter = error instanceof RequestError ? error.response?.headers.get("Retry-After") : undefined;
        if (retryAfter !== undefined && retryAfter !== null) {
            const seconds = Number(retryAfter);
            if (!retryAfter.trim() || !Number.isFinite(seconds) || seconds < 0) {
                return undefined;
            }
            delay = Math.max(delay, seconds * 1000);
        }
        return delay;
    }

    private async waitForRetry(delay: number, signal?: AbortSignal | null): Promise<void> {
        let timer: ReturnType<typeof setTimeout>;
        const waiting = new Promise<void>(resolve => { timer = setTimeout(resolve, delay); });
        try {
            await abortable(waiting, AbortSignal.any([this.stopped.signal, ...(signal ? [signal] : [])]));
        } finally {
            clearTimeout(timer!);
        }
    }

    public get pendingSize(): number {
        return this.pendingRequests;
    }

    public end(): void {
        this.queue.end();
        this.stopped.abort(new JobCancelledError("ended"));
    }
}

export class Requests {

    private static genericQueue = new RequestQueue();
    private static mcAssetRequestQueue = new RequestQueue();

    public static genericRequest(request: RequestConfig): Promise<RequestResponse> {
        return this.genericQueue.request(request);
    }

    public static mcAssetRequest(request: RequestConfig): Promise<RequestResponse> {
        return this.mcAssetRequestQueue.request(request);
    }

    public static setMcAssetRoot(root: string) {
        this.mcAssetRequestQueue.baseURL = root;
    }

    /** Counts unsettled calls, including retry delays and requests still running after shutdown. */
    public static get queueSizes() {
        return {
            generic: this.genericQueue.pendingSize,
            mcAsset: this.mcAssetRequestQueue.pendingSize
        }
    }

    /**
     * Permanently stops both queues and rejects waiting, retrying, and future requests.
     * Requests already running can finish. Idle queues hold no timer, so Node can exit without
     * this cleanup. See {@link shutdown}.
     */
    public static end() {
        this.genericQueue.end();
        this.mcAssetRequestQueue.end();
    }

}
