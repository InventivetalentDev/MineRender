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
});

test.serial("inline scenes retain document defaults and accept URL overrides", async t => {
    const encoded = await encodeSceneDocument(document);
    t.deepEqual(await loadEmbedScene(parse(`#scene=${encoded}`), signal()), document);
    const loaded = await loadEmbedScene(parse(`?version=1.21.11&camera.target=0,12,0#scene=${encoded}`), signal());
    t.is(loaded.minecraftVersion, "1.21.11");
    t.deepEqual(loaded.camera, { position: [30, 20, 40], target: [0, 12, 0] });
});

test.serial("remote scenes omit credentials and accept URL overrides", async t => {
    mockFetch(t, async (url, options) => {
        t.is(url, "https://scenes.example/scene.json");
        t.is(options?.credentials, "omit");
        return response(JSON.stringify(document));
    });
    const request = parse("?src=https://scenes.example/scene.json&version=1.21.11&camera.position=10,20,30");
    const loaded = await loadEmbedScene(request, signal());
    t.is(loaded.minecraftVersion, "1.21.11");
    t.deepEqual(loaded.camera, { position: [10, 20, 30], target: [0, 8, 0] });
});

test.serial("remote scenes reject HTTP errors, HTTPS downgrades, invalid JSON, and invalid documents", async t => {
    const cases: Array<[Response, RegExp]> = [
        [response("missing", { status: 404 }), /HTTP 404/],
        [response("{}", undefined, "http://scenes.example/scene.json"), /HTTPS/],
        [response("{"), /invalid JSON/],
        [response(JSON.stringify({ ...document, objects: [{ id: "invalid", type: "block" }] })), /asset: required/]
    ];
    const responses = cases.map(([result]) => result);
    mockFetch(t, async () => responses.shift()!);
    for (const [, message] of cases) {
        await t.throwsAsync(loadEmbedScene(remote(), signal()), { message });
    }
});

test.serial("remote scenes accept 1 MiB and reject larger declared or actual bodies", async t => {
    const atLimit = JSON.stringify(document).padEnd(SCENE_DOCUMENT_MAX_BYTES);
    const results = [response(atLimit),
        response("{}", { headers: { "content-length": String(SCENE_DOCUMENT_MAX_BYTES + 1) } }),
        response(`${atLimit} `, { headers: { "content-length": "1" } })];
    mockFetch(t, async () => results.shift()!);
    t.deepEqual(await loadEmbedScene(remote(), signal()), document);
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /exceeds 1 MiB/ });
    await t.throwsAsync(loadEmbedScene(remote(), signal()), { message: /exceeds 1 MiB/ });
});

test.serial("caller cancellation aborts a pending remote request", async t => {
    const controller = new AbortController();
    const reason = new Error("Embed disposed during loading");
    mockFetch(t, (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    const rejected = t.throwsAsync(loadEmbedScene(remote(), controller.signal), { is: reason });
    controller.abort(reason);
    await rejected;
});

test.serial("loading accepts large scene documents within the shared schema and byte limit", async t => {
    const large: SceneDocument = { ...document, objects: Array.from({ length: 2048 }, (_, index) => ({
        id: `block-${index}`, type: "block", asset: "minecraft:stone", position: [index * 16, 0, 0]
    })) };
    const request = parse("?block=stone");
    request.source = { kind: "scene", scene: large };
    t.is((await loadEmbedScene(request, signal())).objects.length, 2048);
    const encoded = await encodeSceneDocument(large);
    t.is((await loadEmbedScene(parse(`#scene=${encoded}`), signal())).objects.length, 2048);
    mockFetch(t, async () => response(JSON.stringify(large)));
    t.is((await loadEmbedScene(remote(), signal())).objects.length, 2048);
});

test.serial("shorthand documents use the shared schema and byte limit at the load boundary", async t => {
    for (const query of ["?item=minecraft:../stone", "?model=https://example.com/model.json", "?entity=pig&animate=", "?skin=Notch&cape="]) {
        await t.throwsAsync(loadEmbedScene(parse(query), signal()));
    }
    const oversized = parse(`?skin=${encodeURIComponent(`https://example.com/${"a".repeat(SCENE_DOCUMENT_MAX_BYTES)}`)}`);
    await t.throwsAsync(loadEmbedScene(oversized, signal()), { message: /exceeds 1 MiB/ });
});
