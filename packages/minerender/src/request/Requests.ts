import { JobCancelledError, JobQueue } from "jobqu";
import { Time } from "@inventivetalent/time";
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

export class RequestTimeoutError extends Error {
    constructor() {
        super("Request timed out");
        this.name = "RequestTimeoutError";
    }
}

function isNetworkFailure(error: unknown): boolean {
    if (!(error instanceof TypeError)) {
        return false;
    }
    const cause = (error as TypeError & { cause?: { code?: string } }).cause;
    if (cause) {
        return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT",
            "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"].includes(cause.code ?? "");
    }
    // Browsers expose network and CORS failures as TypeError without an underlying cause.
    return typeof window !== "undefined";
}

async function fetchRequest(config: RequestConfig, defaultBaseURL?: string): Promise<RequestResponse> {
    const { url, baseURL = defaultBaseURL, timeout = 5000, responseType = "json", signal, ...options } = config;
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) {
        throw new RangeError("Request timeout must be between 0 and 2147483647 milliseconds");
    }
    if (responseType !== "json" && responseType !== "arraybuffer") {
        throw new TypeError("Unsupported response type");
    }
    const target = baseURL && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(url)
        ? `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url;
    const headers = new Headers(options.headers);
    if (typeof window === "undefined" && !headers.has("User-Agent")) {
        headers.set("User-Agent", "MineRender");
    }
    const controller = new AbortController();
    // Validate configuration before classifying any Fetch rejection as a network failure.
    const request = new Request(target, { ...options, headers, signal: controller.signal });
    signal?.throwIfAborted();
    const abort = () => controller.abort(signal!.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new RequestTimeoutError()), timeout) : undefined;
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
        if (controller.signal.aborted) {
            throw controller.signal.reason;
        }
        if (/^https?:/.test(request.url) && request.redirect !== "error" && isNetworkFailure(error)) {
            throw new RequestError("Network request failed", undefined, error);
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}

class RequestQueue extends JobQueue<RequestConfig, RequestResponse> {

    private static readonly MAX_ACTIVE = 8;
    private static readonly MAX_RETRIES = 3;
    private static readonly MAX_RETRY_DELAY = 30000;

    public baseURL?: string;
    private pendingRequests = 0;
    private readonly retryTimers = new Map<ReturnType<typeof setTimeout>, (error: unknown) => void>();

    constructor() {
        super(request => fetchRequest(request, this.baseURL), Time.millis(10), 1);
    }

    protected run(): void {
        if (this.activeSize < RequestQueue.MAX_ACTIVE) {
            super.run();
        }
    }

    protected ensureScheduled(): void {
        // Finishing an active job resumes dispatch without polling a full queue.
        if (this.activeSize < RequestQueue.MAX_ACTIVE) {
            super.ensureScheduled();
        }
    }

    public async request(request: RequestConfig): Promise<RequestResponse> {
        this.pendingRequests++;
        const signal = request.signal;
        let abort: (() => void) | undefined;
        try {
            signal?.throwIfAborted();
            const cancelled = signal ? new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason);
                signal.addEventListener("abort", abort, { once: true });
            }) : undefined;
            for (let retries = 0; ; retries++) {
                signal?.throwIfAborted();
                try {
                    const attempt = this.add(request);
                    return await (cancelled ? Promise.race([attempt, cancelled]) : attempt);
                } catch (error) {
                    console.debug(p, "Request failed", error);
                    const delay = this.retryDelay(error, request, retries);
                    if (delay === undefined) {
                        throw error;
                    }
                    await this.waitForRetry(delay, cancelled);
                }
            }
        } finally {
            if (abort) {
                signal!.removeEventListener("abort", abort);
            }
            if (signal?.aborted) {
                this.remove(request);
            }
            this.pendingRequests--;
        }
    }

    private retryDelay(error: unknown, request: RequestConfig, retries: number): number | undefined {
        if (this.ended || retries >= RequestQueue.MAX_RETRIES ||
            (request.method ?? "get").toLowerCase() !== "get" || request.signal?.aborted) {
            return undefined;
        }
        if (error instanceof RequestError) {
            if (error.response && ![408, 429, 500, 502, 503, 504].includes(error.response.status)) {
                return undefined;
            }
        } else if (!(error instanceof RequestTimeoutError)) {
            return undefined;
        }

        let delay = 100 * (2 ** retries);
        const retryAfter = error instanceof RequestError ? error.response?.headers.get("Retry-After") : undefined;
        if (retryAfter) {
            const seconds = Number(retryAfter);
            const requestedDelay = Number.isFinite(seconds) && seconds >= 0
                ? seconds * 1000
                : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(requestedDelay)) {
                delay = Math.max(delay, requestedDelay);
            }
        }
        // Do not retry earlier than the server requested or keep a retry pending indefinitely.
        return delay <= RequestQueue.MAX_RETRY_DELAY ? delay : undefined;
    }

    private async waitForRetry(delay: number, cancelled?: Promise<never>): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const waiting = new Promise<void>((resolve, reject) => {
                timer = setTimeout(resolve, delay);
                this.retryTimers.set(timer, reject);
            });
            await (cancelled ? Promise.race([waiting, cancelled]) : waiting);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
                this.retryTimers.delete(timer);
            }
        }
    }

    public get pendingSize(): number {
        return this.pendingRequests;
    }

    public end(): void {
        super.end();
        for (const [timer, reject] of this.retryTimers) {
            clearTimeout(timer);
            reject(new JobCancelledError("ended"));
        }
        this.retryTimers.clear();
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
