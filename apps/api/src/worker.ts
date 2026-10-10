import { shutdown } from "minerender/node";
import { render } from "./render.js";
import type { RenderRequest } from "./request.js";

const stop = () => { shutdown(); process.exit(0); };
process.once("disconnect", stop);
process.once("SIGTERM", stop);

let busy = false;
process.on("message", async ({ request, assetOrigins }: { request: RenderRequest; assetOrigins: string[] }) => {
    if (busy) return process.exit(1);
    busy = true;
    let result: { ok: true; png: Buffer } | { ok: false };
    try {
        result = { ok: true, png: await render(request, assetOrigins) };
    } catch {
        result = { ok: false };
    }
    busy = false;
    process.send!(result, error => { if (error) stop(); });
});
