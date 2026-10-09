import { render } from "./render.js";
import type { RenderRequest } from "./request.js";

process.once("disconnect", () => process.exit(1));

process.once("message", async (request: RenderRequest) => {
    let result: { ok: true; png: Buffer } | { ok: false; detail: string };
    try {
        result = { ok: true, png: await render(request) };
    } catch {
        result = { ok: false, detail: "The scene could not be rendered. Check its assets and Minecraft version." };
    }
    process.send!(result, () => process.exit(result.ok ? 0 : 1));
});
