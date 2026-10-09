import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ApiError } from "./problem.js";
import { parseRenderRequest } from "./request.js";
import { RenderStore, type StoreOptions } from "./store.js";
import { renderInProcess } from "./worker-process.js";

export interface RenderServerOptions extends Partial<StoreOptions> {
    maxBodyBytes?: number;
}

function json(response: ServerResponse, status: number, value: unknown, head = false): void {
    const body = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
    response.end(head ? undefined : body);
}

function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const cleanup = () => {
            clearTimeout(timer);
            request.off("data", data);
            request.off("end", end);
            request.off("error", failed);
            request.off("aborted", aborted);
        };
        const failed = (error: unknown) => { cleanup(); reject(error); };
        const aborted = () => failed(new ApiError(400, "The request body was interrupted."));
        const data = (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                failed(new ApiError(413, "The request body exceeds the size limit."));
                request.resume();
            } else chunks.push(chunk);
        };
        const end = () => {
            cleanup();
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(new ApiError(400, "The request body must contain valid JSON.")); }
        };
        const timer = setTimeout(() => {
            failed(new ApiError(408, "The request body exceeded its time limit."));
            request.resume();
        }, 15_000);
        request.on("data", data).once("end", end).once("error", failed).once("aborted", aborted);
    });
}

function positive(value: number, name: string, allowZero = false): number {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${name} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
    return value;
}

/** Creates an HTTP service without opening a listening socket. */
export function createRenderServer(options: RenderServerOptions = {}) {
    const timeoutMs = positive(options.timeoutMs ?? 45_000, "timeoutMs");
    const cacheTtlMs = positive(options.cacheTtlMs ?? 600_000, "cacheTtlMs");
    if (timeoutMs > 2_147_483_647 || cacheTtlMs > 2_147_483_647) throw new Error("Timeout and cache TTL must not exceed 2147483647 milliseconds");
    const store = new RenderStore({
        render: options.render ?? renderInProcess,
        concurrency: positive(options.concurrency ?? 2, "concurrency"),
        maxQueue: positive(options.maxQueue ?? 8, "maxQueue", true),
        timeoutMs,
        cacheBytes: positive(options.cacheBytes ?? 64 * 1024 * 1024, "cacheBytes"),
        cacheTtlMs
    });
    const maxBodyBytes = positive(options.maxBodyBytes ?? 256 * 1024, "maxBodyBytes");
    const server = createServer((request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        const controller = new AbortController();
        const disconnected = () => {
            if (!response.writableEnded) controller.abort(new ApiError(499, "The requesting client disconnected."));
        };
        response.once("close", disconnected);
        void handle(request, response, controller.signal).catch(error => {
            if (response.destroyed || response.writableEnded) return;
            const problem = error instanceof ApiError ? error : new ApiError(500, "The request could not be processed.");
            const body = JSON.stringify(problem.toJSON());
            if (!request.complete || [408, 413, 415].includes(problem.status)) response.setHeader("Connection", "close");
            if (problem.status === 503) response.setHeader("Retry-After", "1");
            response.writeHead(problem.status, { "Content-Type": "application/problem+json", "Content-Length": Buffer.byteLength(body) });
            response.end(request.method === "HEAD" ? undefined : body);
        }).finally(() => response.off("close", disconnected));
    });
    server.maxConnections = 128;
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;

    function method(request: IncomingMessage, response: ServerResponse, allowed: string[]): void {
        if (!allowed.includes(request.method ?? "")) {
            response.setHeader("Allow", allowed.join(", "));
            throw new ApiError(405, "This method is not supported for this resource.");
        }
    }

    async function handle(request: IncomingMessage, response: ServerResponse, signal: AbortSignal): Promise<void> {
        let pathname: string;
        try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; }
        catch { throw new ApiError(400, "The request URL is invalid."); }
        const head = request.method === "HEAD";
        if (pathname === "/healthz") {
            method(request, response, ["GET", "HEAD"]);
            json(response, 200, { status: "ok" }, head);
            return;
        }
        if (pathname === "/v1/renders") {
            method(request, response, ["POST"]);
            if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json"
                || (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")) {
                throw new ApiError(415, "Send uncompressed application/json.");
            }
            if (Number(request.headers["content-length"]) > maxBodyBytes) throw new ApiError(413, "The request body exceeds the size limit.");
            const value = parseRenderRequest(await readBody(request, maxBodyBytes));
            const result = await store.submit(value, signal);
            if (signal.aborted) return;
            response.setHeader("Location", `/v1/renders/${result.record.resource.id}`);
            json(response, result.created ? 201 : 200, result.record.resource);
            return;
        }
        const match = /^\/v1\/renders\/([a-f0-9]{64})(\/image)?$/.exec(pathname);
        if (match) {
            method(request, response, ["GET", "HEAD"]);
            const record = store.get(match[1]);
            if (!record) throw new ApiError(404, "The render was not found or is no longer cached.");
            if (!match[2]) {
                json(response, 200, record.resource, head);
                return;
            }
            response.setHeader("ETag", record.etag);
            response.setHeader("Cache-Control", `private, max-age=${Math.max(0, Math.floor((record.expires - Date.now()) / 1000))}, must-revalidate`);
            const tags = request.headers["if-none-match"]?.split(",").map(tag => tag.trim().replace(/^W\//, ""));
            if (tags?.includes("*") || tags?.includes(record.etag)) {
                response.writeHead(304);
                response.end();
                return;
            }
            response.writeHead(200, { "Content-Type": "image/png", "Content-Length": record.png.length });
            response.end(head ? undefined : record.png);
            return;
        }
        throw new ApiError(404, "The requested resource does not exist.");
    }

    let closing: Promise<void> | undefined;
    return { server, close(): Promise<void> {
        return closing ??= (async () => {
            const stopped = new Promise<void>((resolve, reject) => server.close(error => {
                if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
                else resolve();
            }));
            const workers = store.close();
            server.closeAllConnections();
            await Promise.all([stopped, workers]);
        })();
    } };
}
