import test from "ava";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decode, encode } from "fast-png";
import { createRenderServer } from "../../dist/server.js";
import { parseRenderRequest } from "../../dist/request.js";
import { createRenderPool } from "../../dist/worker-process.js";

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

test("different native renders reuse downloaded blockstate, model, and texture assets", async t => {
    const directory = await mkdtemp(join(tmpdir(), "minerender-assets-test-"));
    const log = join(directory, "requests.jsonl");
    const started = join(directory, "started.jsonl");
    const workerUrl = pathToFileURL(join(directory, "worker.mjs"));
    const texture = Buffer.from(encode({ width: 1, height: 1, channels: 4,
        data: new Uint8Array([192, 32, 16, 255]) })).toString("base64");
    const model = { textures: { all: "minecraft:block/stone" }, elements: [{ from: [0, 0, 0], to: [16, 16, 16],
        faces: Object.fromEntries(["east", "west", "up", "down", "south", "north"].map(face => [face, { texture: "#all" }])) }] };
    await writeFile(workerUrl, `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(started)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + "\\n");
        globalThis.fetch = async input => {
            const url = new URL(input instanceof Request ? input.url : input);
            await appendFile(${JSON.stringify(log)}, JSON.stringify(url.pathname) + "\\n");
            if (url.pathname.endsWith("/blockstates/stone.json")) {
                return Response.json({ variants: { "": { model: "minecraft:block/stone" } } });
            }
            if (url.pathname.endsWith("/models/block/stone.json")) return Response.json(${JSON.stringify(model)});
            if (url.pathname.endsWith("/textures/block/stone.png")) {
                return new Response(Buffer.from(${JSON.stringify(texture)}, "base64"));
            }
            return new Response(null, { status: 404 });
        };
        await import(${JSON.stringify(new URL("../../dist/worker.js", import.meta.url).href)});
    `);
    const pool = createRenderPool(1, { workerUrl });
    try {
        const scene = { format: "minerender-scene", version: 1,
            objects: [{ id: "stone", type: "block", asset: "minecraft:stone" }] };
        for (const width of [64, 96]) {
            const request = parseRenderRequest({ scene, output: { width, height: 64 } });
            const image = decode(await pool.render(request, AbortSignal.timeout(10_000)));
            t.is(image.width, width);
            t.is(image.height, 64);
            const center = (32 * width + Math.floor(width / 2)) * 4;
            t.true(image.data[center] > image.data[center + 1] * 2);
            t.is(image.data[center + 3], 255);
        }
        const requests = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        for (const asset of ["blockstates/stone.json", "models/block/stone.json", "textures/block/stone.png"]) {
            t.is(requests.filter(path => path.endsWith(`/${asset}`)).length, 1, asset);
        }
        const processes = (await readFile(started, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        t.is(processes.length, 1);
        t.true((await readdir(processes[0].cwd)).length > 0);
        await pool.close();
        await t.throwsAsync(stat(processes[0].cwd), { code: "ENOENT" });
    } finally {
        await pool.close();
        await rm(directory, { recursive: true, force: true });
    }
});
