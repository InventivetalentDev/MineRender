import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "./problem.js";
import type { RenderRequest } from "./request.js";

const MAX_PNG_BYTES = 20 * 1024 * 1024;

export async function renderInProcess(request: RenderRequest, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    const cwd = await mkdtemp(join(tmpdir(), "minerender-api-"));
    try {
        signal.throwIfAborted();
        return await new Promise<Buffer>((resolve, reject) => {
            const child = fork(new URL("./worker.js", import.meta.url), {
                cwd,
                serialization: "advanced",
                stdio: ["ignore", "ignore", "ignore", "ipc"],
                execArgv: ["--max-old-space-size=512"]
            });
            let png: Buffer | undefined;
            let failure: unknown;
            const abort = () => {
                failure = signal.reason;
                child.kill("SIGKILL");
            };
            signal.addEventListener("abort", abort, { once: true });
            child.on("error", () => { failure ??= new ApiError(503, "The rendering process is unavailable"); });
            child.on("message", message => {
                const result = message as { ok?: unknown; png?: unknown };
                if (result?.ok === true && Buffer.isBuffer(result.png) && result.png.length <= MAX_PNG_BYTES) {
                    png = result.png;
                } else {
                    failure ??= new ApiError(502, "The scene could not be rendered. Check its assets and Minecraft version.");
                }
            });
            child.once("close", code => {
                signal.removeEventListener("abort", abort);
                if (failure) reject(failure);
                else if (code === 0 && png) resolve(png);
                else reject(new ApiError(503, "The rendering process stopped before producing an image"));
            });
            if (signal.aborted) abort();
            else child.send(request, error => {
                if (!error) return;
                failure ??= new ApiError(503, "The rendering process is unavailable");
                child.kill("SIGKILL");
            });
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
