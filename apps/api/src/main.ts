import { createRenderServer } from "./server.js";

function integer(name: string): number | undefined {
    const value = process.env[name];
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} must be an integer`);
    return Number(value);
}

const host = process.env.HOST ?? "127.0.0.1";
const port = integer("PORT") ?? 3000;
if (port > 65535) throw new Error("PORT must be between 0 and 65535");
const app = createRenderServer({
    concurrency: integer("RENDER_CONCURRENCY"),
    maxQueue: integer("RENDER_MAX_QUEUE"),
    timeoutMs: integer("RENDER_TIMEOUT_MS"),
    cacheBytes: integer("RENDER_CACHE_BYTES"),
    cacheTtlMs: integer("RENDER_CACHE_TTL_MS"),
    maxBodyBytes: integer("RENDER_MAX_BODY_BYTES"),
    assetOrigins: process.env.RENDER_ASSET_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean)
});

app.server.on("error", error => {
    console.error(error.message);
    process.exitCode = 1;
    void app.close();
});
app.server.listen(port, host, () => {
    const address = app.server.address();
    console.log(`MineRender API listening on ${typeof address === "object" && address ? `${address.address}:${address.port}` : address}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void app.close(); });
}
