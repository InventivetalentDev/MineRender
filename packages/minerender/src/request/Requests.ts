import axios from "axios";
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { JobCancelledError, JobQueue } from "jobqu";
import { Time } from "@inventivetalent/time";
import { prefix } from "../util/log";

const p = prefix("Requests");

interface RequestCancellation {
    cancel?: (error: unknown) => void;
}

class RequestQueue extends JobQueue<AxiosRequestConfig, AxiosResponse> {

    private static readonly MAX_ACTIVE = 8;
    private static readonly MAX_RETRIES = 3;
    private static readonly MAX_RETRY_DELAY = 30000;

    private pendingRequests = 0;
    private readonly retryTimers = new Map<ReturnType<typeof setTimeout>, (error: unknown) => void>();

    constructor(instance: AxiosInstance) {
        super(request => instance.request({ ...request }), Time.millis(10), 1);
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

    public async request(request: AxiosRequestConfig): Promise<AxiosResponse> {
        this.pendingRequests++;
        const cancellation: RequestCancellation = {};
        try {
            // Axios 0.21 cannot unsubscribe token listeners. Clear the callback after settling
            // so a retained token does not retain a completed request.
            const cancelled = request.cancelToken ? new Promise<never>((_, reject) => {
                cancellation.cancel = reject;
                request.cancelToken!.promise.then(reason => cancellation.cancel?.(reason));
            }) : undefined;
            for (let retries = 0; ; retries++) {
                request.cancelToken?.throwIfRequested();
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
            cancellation.cancel = undefined;
            if (request.cancelToken?.reason) {
                this.remove(request);
            }
            this.pendingRequests--;
        }
    }

    private retryDelay(error: unknown, request: AxiosRequestConfig, retries: number): number | undefined {
        if (this.ended || retries >= RequestQueue.MAX_RETRIES ||
            (request.method ?? "get").toLowerCase() !== "get" ||
            request.cancelToken?.reason || error === null || typeof error !== "object" ||
            axios.isCancel(error) || !axios.isAxiosError(error)) {
            return undefined;
        }

        if (error.response) {
            if (![408, 429, 500, 502, 503, 504].includes(error.response.status)) {
                return undefined;
            }
        } else if (error.message === "Request aborted" ||
            !(["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ERR_NETWORK"].includes(error.code ?? "") ||
                (!error.code && error.request && error.message === "Network Error"))) {
            return undefined;
        }

        let delay = 100 * (2 ** retries);
        const retryAfter = error.response?.headers?.["retry-after"];
        if (typeof retryAfter === "string" || typeof retryAfter === "number") {
            const seconds = Number(retryAfter);
            const requestedDelay = Number.isFinite(seconds) && seconds >= 0
                ? seconds * 1000
                : Date.parse(String(retryAfter)) - Date.now();
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

    private static createInstance(): AxiosInstance {
        return axios.create({
            timeout: 5000,
            headers: typeof window === "undefined" ? { "User-Agent": "MineRender" } : {}
        });
    }

    private static axiosInstance: AxiosInstance = Requests.createInstance();
    private static mcAssetInstance: AxiosInstance = Requests.createInstance();

    private static genericQueue = new RequestQueue(Requests.axiosInstance);
    private static mcAssetRequestQueue = new RequestQueue(Requests.mcAssetInstance);

    public static genericRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.genericQueue.request(request);
    }

    public static mcAssetRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mcAssetRequestQueue.request(request);
    }

    public static setMcAssetRoot(root: string) {
        this.mcAssetInstance.defaults.baseURL = root;
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
