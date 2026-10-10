import test from "ava";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createRenderServer } from "../dist/server.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5yQAAAAASUVORK5CYII=", "base64");

function scene(asset = "minecraft:stone") {
    return { scene: { format: "minerender-scene", version: 1, objects: [{ id: "block", type: "block", asset }] } };
}

function gate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

async function start(t, options = {}) {
    const service = createRenderServer({ render: async () => png, ...options });
    service.server.listen(0, "127.0.0.1");
    await once(service.server, "listening");
    t.teardown(() => service.close());
    const base = `http://127.0.0.1:${service.server.address().port}`;
    const fetchPath = (path, options = {}) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000), ...options });
    const post = (body = scene(), options = {}) => fetchPath("/v1/renders", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...options
    });
    return { ...service, base, fetchPath, post };
}

async function problem(t, response, status) {
    t.is(response.status, status);
    t.regex(response.headers.get("content-type"), /^application\/problem\+json/);
    const body = await response.json();
    t.is(body.status, status);
    t.is(body.type, "about:blank");
    t.is(typeof body.title, "string");
    t.is(typeof body.detail, "string");
}

test("render resources expose PNG metadata, HEAD, conditional requests, and canonical cache reuse", async t => {
    let calls = 0;
    let rendered;
    const api = await start(t, { render: async request => { calls++; rendered = request; return png; } });
    const health = await api.fetchPath("/healthz");
    t.is(health.status, 200);
    const healthHead = await api.fetchPath("/healthz", { method: "HEAD" });
    t.is(healthHead.status, 200);
    t.is(await healthHead.text(), "");

    const created = await api.post();
    t.is(created.status, 201);
    const resource = await created.json();
    const location = created.headers.get("location");
    t.is(location, `/v1/renders/${resource.id}`);
    t.is(resource.status, "completed");
    t.true(Date.parse(resource.expiresAt) > Date.parse(resource.createdAt));
    t.deepEqual(resource.image, { href: `${location}/image`, mediaType: "image/png", width: 1, height: 1 });
    t.deepEqual(rendered.output, { width: 512, height: 512, format: "png", trim: false, background: null });
    t.is(rendered.scene.minecraftVersion, "1.21.11");

    const metadata = await api.fetchPath(location);
    t.is(metadata.status, 200);
    t.deepEqual(await metadata.json(), resource);
    const metadataHead = await api.fetchPath(location, { method: "HEAD" });
    t.is(metadataHead.status, 200);
    t.is(await metadataHead.text(), "");

    const image = await api.fetchPath(resource.image.href);
    t.is(image.status, 200);
    t.is(image.headers.get("content-type"), "image/png");
    t.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const etag = image.headers.get("etag");
    t.truthy(etag);
    const imageHead = await api.fetchPath(resource.image.href, { method: "HEAD" });
    t.is(imageHead.status, 200);
    t.is(imageHead.headers.get("etag"), etag);
    t.is(imageHead.headers.get("content-length"), String(png.length));
    t.is(await imageHead.text(), "");
    const unchanged = await api.fetchPath(resource.image.href, { headers: { "if-none-match": etag } });
    t.is(unchanged.status, 304);
    t.is(await unchanged.text(), "");

    const reordered = { output: { background: null, trim: false, format: "png", height: 512, width: 512 }, scene: {
        objects: [{ asset: "minecraft:stone", type: "block", id: "block" }], minecraftVersion: "1.21.11", version: 1, format: "minerender-scene"
    } };
    const reused = await api.post(reordered);
    t.is(reused.status, 200);
    t.deepEqual(await reused.json(), resource);
    t.is(calls, 1);
    await problem(t, await api.fetchPath("/v1/renders/missing"), 404);
    await problem(t, await api.fetchPath("/v1/renders/missing/image"), 404);
});

test("simultaneous identical requests share a render", async t => {
    const entered = gate();
    const release = gate();
    let calls = 0;
    const api = await start(t, { render: async () => { calls++; entered.release(); await release.promise; return png; } });
    t.teardown(() => release.release());
    const first = api.post();
    await entered.promise;
    const second = api.post();
    await delay(30);
    release.release();
    const responses = await Promise.all([first, second]);
    t.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    const resources = await Promise.all(responses.map(response => response.json()));
    t.deepEqual(resources[0], resources[1]);
    t.is(calls, 1);
});

test("request errors reject before rendering and methods advertise their allowed verbs", async t => {
    let calls = 0;
    const api = await start(t, { maxBodyBytes: 2048, render: async () => { calls++; return png; } });
    await problem(t, await api.post(undefined, { body: "{" }), 400);
    await problem(t, await api.post(undefined, { headers: { "content-type": "text/plain" } }), 415);
    await problem(t, await api.post(undefined, { body: " ".repeat(2049) }), 413);
    const cases = [
        {},
        { ...scene(), extra: true },
        { scene: { ...scene().scene, objects: [] } },
        { scene: { ...scene().scene, objects: Array.from({ length: 33 }, (_, i) => ({ id: String(i), type: "skin" })) } },
        { ...scene(), output: { width: 0 } },
        { ...scene(), output: { height: 2049 } },
        { ...scene(), output: { width: 1.5 } },
        { ...scene(), output: { format: "jpeg" } },
        { ...scene(), output: { background: 0x1000000 } },
        { ...scene(), output: { trim: "true" } },
        { scene: { ...scene().scene, objects: [{ id: "block", type: "block", asset: "../secret" }] } },
        { scene: { ...scene().scene, objects: [{ id: "player", type: "skin", skin: "http://127.0.0.1/private" }] } },
        { scene: { ...scene().scene, objects: [{ id: "player", type: "skin", skin: "data:image/png;base64,AA==" }] } },
        { scene: { ...scene().scene, objects: [{ id: "player", type: "skin", cape: { texture: "file:///tmp/cape.png" } }] } }
    ];
    for (const input of cases) await problem(t, await api.post(input), 422);
    for (const [path, method, allowed] of [["/v1/renders", "GET", "POST"], ["/healthz", "POST", "GET, HEAD"]]) {
        const response = await api.fetchPath(path, { method });
        await problem(t, response, 405);
        t.is(response.headers.get("allow"), allowed);
    }
    t.is(calls, 0);
});

test("render failures return a problem and permit retrying the same request", async t => {
    let calls = 0;
    const api = await start(t, { render: async () => {
        if (++calls === 1) throw new Error("fixture render failed");
        return png;
    } });
    await problem(t, await api.post(), 502);
    t.is((await api.post()).status, 201);
    t.is(calls, 2);
});

test("render concurrency and queue length are bounded", async t => {
    const entered = gate();
    const release = gate();
    let running = 0;
    let peak = 0;
    let calls = 0;
    const api = await start(t, { concurrency: 1, maxQueue: 1, render: async () => {
        calls++;
        peak = Math.max(peak, ++running);
        entered.release();
        await release.promise;
        running--;
        return png;
    } });
    t.teardown(() => release.release());
    const first = api.post();
    await entered.promise;
    const others = [api.post(scene("minecraft:dirt")), api.post(scene("minecraft:sand"))];
    const busy = await Promise.race(others);
    await problem(t, busy.clone(), 503);
    t.truthy(busy.headers.get("retry-after"));
    release.release();
    const responses = await Promise.all([first, ...others]);
    t.deepEqual(responses.map(response => response.status).sort(), [201, 201, 503]);
    t.is(calls, 2);
    t.is(peak, 1);
});

test("deadlines abort active renders and permit later work", async t => {
    let aborted = false;
    let calls = 0;
    const api = await start(t, { timeoutMs: 80, render: async (_request, signal) => {
        if (++calls !== 1) return png;
        await new Promise((resolve, reject) => signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
        }, { once: true }));
        return png;
    } });
    await problem(t, await api.post(), 504);
    t.true(aborted);
    t.is((await api.post()).status, 201);
    t.is(calls, 2);
});

test("queued deadlines include waiting time and do not release active capacity before cleanup", async t => {
    const entered = gate();
    const cleanup = gate();
    let calls = 0;
    const api = await start(t, { concurrency: 1, timeoutMs: 80, render: async (_request, signal) => {
        calls++;
        entered.release();
        await cleanup.promise;
        signal.throwIfAborted();
        return png;
    } });
    t.teardown(() => cleanup.release());
    const first = api.post();
    await entered.promise;
    const queued = api.post(scene("minecraft:dirt"));
    try {
        const responses = await Promise.all([first, queued]);
        for (const response of responses) await problem(t, response, 504);
        t.is(calls, 1);
    } finally {
        cleanup.release();
    }
});

test("disconnecting the only client aborts its active render", async t => {
    const entered = gate();
    const aborted = gate();
    const api = await start(t, { render: async (_request, signal) => {
        entered.release();
        await new Promise((resolve, reject) => signal.addEventListener("abort", () => {
            aborted.release();
            reject(signal.reason);
        }, { once: true }));
        return png;
    } });
    const request = httpRequest(`${api.base}/v1/renders`, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => {});
    request.end(JSON.stringify(scene()));
    await entered.promise;
    request.destroy();
    await Promise.race([aborted.promise, delay(1000).then(() => { throw new Error("render was not aborted after disconnect"); })]);
    t.pass();
});

test("disconnecting one waiter preserves a render needed by another client", async t => {
    const entered = gate();
    const release = gate();
    let aborted = false;
    let calls = 0;
    const api = await start(t, { render: async (_request, signal) => {
        calls++;
        signal.addEventListener("abort", () => { aborted = true; }, { once: true });
        entered.release();
        await release.promise;
        return png;
    } });
    t.teardown(() => release.release());
    const request = httpRequest(`${api.base}/v1/renders`, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => {});
    request.end(JSON.stringify(scene()));
    await entered.promise;
    const other = api.post();
    await delay(30);
    request.destroy();
    await delay(10);
    t.false(aborted);
    release.release();
    t.is((await other).status, 200);
    t.is(calls, 1);
});

test("expired resources return 404 and can be rendered again", async t => {
    let calls = 0;
    const api = await start(t, { cacheTtlMs: 60, render: async () => { calls++; return png; } });
    const response = await api.post();
    const resource = await response.json();
    await delay(90);
    await problem(t, await api.fetchPath(`/v1/renders/${resource.id}`), 404);
    await problem(t, await api.fetchPath(resource.image.href), 404);
    t.is((await api.post()).status, 201);
    t.is(calls, 2);
});

test("the byte budget evicts the least recently used resource", async t => {
    const api = await start(t, { cacheBytes: png.length * 2 });
    const first = await (await api.post()).json();
    const second = await (await api.post(scene("minecraft:dirt"))).json();
    t.is((await api.fetchPath(first.image.href)).status, 200);
    const third = await (await api.post(scene("minecraft:sand"))).json();
    t.is((await api.fetchPath(first.image.href)).status, 200);
    await problem(t, await api.fetchPath(second.image.href), 404);
    t.is((await api.fetchPath(third.image.href)).status, 200);
    const undersized = await start(t, { cacheBytes: png.length - 1 });
    await problem(t, await undersized.post(), 503);
});
