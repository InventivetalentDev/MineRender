import test from "ava";
import { guardFetch, normalizeAssetOrigins } from "../dist/assets.js";

test("asset-origin configuration accepts only HTTPS origins", t => {
    t.deepEqual(normalizeAssetOrigins(["https://cdn.example.test/", "https://cdn.example.test"]), ["https://cdn.example.test"]);
    for (const value of ["http://cdn.example.test", "https://user:pass@cdn.example.test", "https://cdn.example.test/path",
        "https://cdn.example.test/?token=secret", "https://cdn.example.test/#fragment", "*"]) {
        t.throws(() => normalizeAssetOrigins([value]));
    }
});

test.serial("asset redirects require a trusted origin at every hop", async t => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let location = "https://cdn.example.test/texture.png?signature=test";
    globalThis.fetch = async request => {
        requests.push(request.url);
        return new URL(request.url).hostname === "textures.minecraft.net"
            ? Response.redirect(location, 302) : new Response("texture");
    };
    let restore = guardFetch();
    t.teardown(() => { restore(); globalThis.fetch = originalFetch; });
    const texture = "https://textures.minecraft.net/texture/abcdef";
    await t.throwsAsync(fetch(texture), { message: "Unsupported asset source" });
    t.deepEqual(requests, [texture]);
    restore();
    requests.length = 0;
    restore = guardFetch(normalizeAssetOrigins(["https://cdn.example.test"]));
    t.is(await (await fetch(texture)).text(), "texture");
    t.deepEqual(requests, [texture, location]);
    requests.length = 0;
    location = "http://127.0.0.1/private";
    await t.throwsAsync(fetch(texture), { message: "Unsupported asset source" });
    t.deepEqual(requests, [texture]);
});
