import test from "ava";
import type { ExecutionContext } from "ava";
import { encodeSceneDocument, SCENE_DOCUMENT_MAX_BYTES } from "minerender/browser";
import type { SceneDocument } from "minerender";
import { loadEmbedScene } from "../src/load";
import { parseEmbedUrl } from "../src/params";

const document: SceneDocument = {
    format: "minerender-scene", version: 1, minecraftVersion: "1.21.10",
    camera: { position: [30, 20, 40], target: [0, 8, 0] },
    objects: [{ id: "block", type: "block", asset: "minecraft:stone" }]
};
const parse = (query: string) => parseEmbedUrl(new URL(`https://embed.example/embed/${query}`));
const remote = () => parse("?src=https://scenes.example/scene.json");
const signal = () => new AbortController().signal;

function response(body: BodyInit | null, init?: ResponseInit, url = "https://scenes.example/scene.json"): Response {
    const result = new Response(body, init);
    Object.defineProperty(result, "url", { value: url });
    return result;
}

function mockFetch(t: ExecutionContext, handler: typeof fetch): void {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    t.teardown(() => { globalThis.fetch = original; });
}

test.serial("URL camera and version overrides replace document values without mutating the source", async t => {
    const request = parse("?block=stone&version=1.21.11&camera.position=50,30,60");
    request.source = { kind: "scene", scene: document };
    const loaded = await loadEmbedScene(request, signal());
    t.is(loaded.minecraftVersion, "1.21.11");
    t.deepEqual(loaded.camera, { position: [50, 30, 60], target: [0, 8, 0] });
    t.is(document.minecraftVersion, "1.21.10");
    t.deepEqual(document.camera, { position: [30, 20, 40], target: [0, 8, 0] });

    const targetOnly = parse("?block=stone&camera.target=1,2,3");
    targetOnly.source = { kind: "scene", scene: document };
    t.deepEqual((await loadEmbedScene(targetOnly, signal())).camera, { position: [30, 20, 40], target: [1, 2, 3] });

    const collision = parse("?block=stone&camera.target=30,20,40");
    collision.source = { kind: "scene", scene: document };
    await t.throwsAsync(loadEmbedScene(collision, signal()), { message: /must differ/ });
});

test.serial("inline scenes retain document defaults and accept URL overrides", async t => {
    const encoded = await encodeSceneDocument(document);
    t.deepEqual(await loadEmbedScene(parse(`#scene=${encoded}`), signal()), document);
    const loaded = await loadEmbedScene(parse(`?version=1.21.11&camera.target=0,12,0#scene=${encoded}`), signal());
    t.is(loaded.minecraftVersion, "1.21.11");
    t.deepEqual(loaded.camera, { position: [30, 20, 40], target: [0, 12, 0] });
});

test.serial("remote scenes omit credentials and use a cancellable fetch signal", async t => {
    const controller = new AbortController();
    mockFetch(t, async (url, options) => {
        t.is(url, "https://scenes.example/scene.json");
        t.is(options?.credentials, "omit");
        t.true(options?.signal instanceof AbortSignal);
        t.not(options?.signal, controller.signal);
        return response(JSON.stringify(document));
    });
    const request = parse("?src=https://scenes.example/scene.json&version=1.21.11&camera.position=10,20,30");
    const loaded = await loadEmbedScene(request, controller.signal);
    t.is(loaded.minecraftVersion, "1.21.11");
    t.deepEqual(loaded.camera, { position: [10, 20, 30], target: [0, 8, 0] });
});

test.serial("remote responses reject HTTP errors, HTTPS downgrades, invalid JSON, malformed UTF-8, and invalid scenes", async t => {
    const cancelled: string[] = [];
    const unusedBody = (name: string) => new ReadableStream<Uint8Array>({
        pull() { t.fail("Rejected responses must not read the body"); },
        cancel() { cancelled.push(name); }
    }, { highWaterMark: 0 });
    const responses = [
        response(unusedBody("HTTP error"), { status: 404 }),
        response(unusedBody("HTTPS downgrade"), undefined, "http://scenes.example/scene.json"),
        response(null, { status: 204 }),
        response("{"),
        response(new Uint8Array([0xff])),
        response(JSON.stringify({ ...document, objects: [] }))
    ];
    mockFetch(t, async () => responses.shift()!);
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /HTTP 404/ });
    t.deepEqual(cancelled, ["HTTP error"]);
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /HTTPS/ });
    t.deepEqual(cancelled, ["HTTP error", "HTTPS downgrade"]);
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /no body/ });
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { instanceOf: SyntaxError });
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { instanceOf: TypeError });
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /1 to 32/ });
});

test.serial("oversized content-length cancels the response without reading its body", async t => {
    let cancelled = false;
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
        pull() { pulled = true; },
        cancel() { cancelled = true; }
    }, { highWaterMark: 0 });
    mockFetch(t, async () => response(body, { headers: { "content-length": String(SCENE_DOCUMENT_MAX_BYTES + 1) } }));
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /exceeds 1 MiB/ });
    t.true(cancelled);
    t.false(pulled);
});

test.serial("chunked responses enforce the byte limit and cancel excess input", async t => {
    const json = JSON.stringify(document);
    const exactlyAtLimit = `${json}${" ".repeat(SCENE_DOCUMENT_MAX_BYTES - new TextEncoder().encode(json).length)}`;
    let cancelled = false;
    let nextChunk = 0;
    const chunks = [new Uint8Array(SCENE_DOCUMENT_MAX_BYTES), new Uint8Array([32])];
    const body = new ReadableStream<Uint8Array>({
        pull(controller) { if (nextChunk < chunks.length) controller.enqueue(chunks[nextChunk++]); },
        cancel() { cancelled = true; }
    }, { highWaterMark: 0 });
    const responses = [response(exactlyAtLimit), response(body, { headers: { "content-length": "1" } })];
    mockFetch(t, async () => responses.shift()!);
    t.deepEqual(await loadEmbedScene(remote(), signal()), document);
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /exceeds 1 MiB/ });
    t.true(cancelled);
    t.false(body.locked);
});

test.serial("already aborted loads reject for scene, inline, and remote sources", async t => {
    const controller = new AbortController();
    const reason = new Error("Caller cancelled the embed");
    controller.abort(reason);
    mockFetch(t, async (_url, options) => {
        options?.signal?.throwIfAborted();
        throw new Error("Expected an aborted fetch signal");
    });
    await t.throwsAsync(loadEmbedScene(parse("?block=stone"), controller.signal), { is: reason });
    await t.throwsAsync(loadEmbedScene(parse(`#scene=${await encodeSceneDocument(document)}`), controller.signal), { is: reason });
    await t.throwsAsync(loadEmbedScene(remote(), controller.signal), { is: reason });
});

test.serial("aborting a remote load interrupts body reading and releases the reader", async t => {
    const controller = new AbortController();
    const reason = new Error("Embed disposed during loading");
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    let body!: ReadableStream<Uint8Array>;
    mockFetch(t, async (_url, options) => {
        const fetchSignal = options!.signal!;
        body = new ReadableStream<Uint8Array>({
            start(stream) { fetchSignal.addEventListener("abort", () => stream.error(fetchSignal.reason), { once: true }); },
            pull() { started(); }
        }, { highWaterMark: 0 });
        return response(body);
    });
    const loading = loadEmbedScene(remote(), controller.signal);
    const rejected = t.throwsAsync(loading, { is: reason });
    await reading;
    controller.abort(reason);
    await rejected;
    t.false(body.locked);
});
