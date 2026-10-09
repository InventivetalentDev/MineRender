import test from "ava";
import { once } from "node:events";
import { decode } from "fast-png";
import { createRenderServer } from "../../dist/server.js";

test("HTTP rendering uses an isolated native process and returns its PNG", async t => {
    const api = createRenderServer({ timeoutMs: 15_000 });
    api.server.listen(0, "127.0.0.1");
    await once(api.server, "listening");
    t.teardown(() => api.close());
    const base = `http://127.0.0.1:${api.server.address().port}`;
    const scene = { format: "minerender-scene", version: 1, objects: [{ id: "empty", type: "gui", layers: [] }] };
    const post = output => fetch(`${base}/v1/renders`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scene, output }), signal: AbortSignal.timeout(20_000) });
    const rendered = await post({ width: 37, height: 23, background: 0x4080c0 });
    t.is(rendered.status, 201);
    const resource = await rendered.json();
    const response = await fetch(`${base}${resource.image.href}`);
    t.is(response.headers.get("content-type"), "image/png");
    const image = decode(new Uint8Array(await response.arrayBuffer()));
    t.is(image.width, 37);
    t.is(image.height, 23);
    t.deepEqual(Array.from(image.data.slice(0, 4)), [64, 128, 192, 255]);
    t.deepEqual(Array.from(image.data.slice(-4)), [64, 128, 192, 255]);

    const transparent = await post({ width: 23, height: 37, trim: true });
    t.is(transparent.status, 201);
    const trimmedResource = await transparent.json();
    t.is(trimmedResource.image.width, 1);
    t.is(trimmedResource.image.height, 1);
    const trimmed = decode(new Uint8Array(await (await fetch(`${base}${trimmedResource.image.href}`)).arrayBuffer()));
    t.deepEqual(Array.from(trimmed.data), [0, 0, 0, 0]);
});
