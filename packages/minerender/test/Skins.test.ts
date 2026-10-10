import test from "ava";
import { Requests } from "../src/request/Requests";
import { Skins } from "../src/skin/Skins";
import { Caching } from "../src/cache/Caching";

test.serial("username lookups share requests for five minutes and reload after clearing caches", async t => {
    const originalRequest = Requests.genericRequest, originalNow = Date.now;
    let now = originalNow(), requests = 0;
    Caching.clear();
    t.teardown(() => { Requests.genericRequest = originalRequest; Date.now = originalNow; Caching.clear(); });
    Date.now = () => now;
    Requests.genericRequest = async request => {
        requests++;
        return { data: { data: { id: "alex-uuid" } }, status: 200, statusText: "OK", headers: new Headers(), url: request.url };
    };
    const skin = "https://mcproxy.dev/skin/alex-uuid";
    t.deepEqual(await Promise.all([Skins.fromUsername("Alex"), Skins.fromUsername("Alex")]), [skin, skin]);
    t.is(requests, 1);
    now += 299_999;
    t.is(await Skins.capeFromUsername("Alex"), "https://mcproxy.dev/cape/alex-uuid");
    t.is(requests, 1);
    now += 2;
    t.is(await Skins.fromUsername("Alex"), skin);
    t.is(requests, 2);
    Caching.clear();
    t.is(await Skins.fromUsername("Alex"), skin);
    t.is(requests, 3);
});

test.serial("capes.dev resolves names and UUIDs to full static textures and distinguishes missing capes from failed requests", async t => {
    const original = Requests.genericRequest;
    t.teardown(() => { Requests.genericRequest = original; });
    const responses = [
        { exists: true, imageUrls: { still: { full: "https://example.com/vanilla.png" } } },
        { exists: true, imageUrls: { still: { full: "https://example.com/optifine.png" } } },
        { exists: false, imageUrls: { still: { full: "https://example.com/placeholder.png" } } },
        { exists: true, imageUrls: { animated: { full: "https://example.com/animated.gif" } } }
    ];
    const urls: string[] = [];
    const error = new Error("cape service unavailable");
    Requests.genericRequest = async request => {
        urls.push(`${request.baseURL}${request.url}`);
        const data = responses.shift();
        if (!data) throw error;
        return { data, status: 200, statusText: "OK", headers: new Headers(), url: urls.at(-1)! };
    };
    const uuid = "bcd2033c-63ec-4bf8-8aca-680b22461340";
    t.is(await Skins.capeFromCapesDev("Alex"), "https://example.com/vanilla.png");
    t.is(await Skins.capeFromCapesDev(uuid, "optifine"), "https://example.com/optifine.png");
    t.is(await Skins.capeFromCapesDev("NoCape", "labymod"), undefined);
    t.is(await Skins.capeFromCapesDev("NoStill"), undefined);
    t.deepEqual(urls, [
        "https://api.capes.dev/load/Alex/minecraft",
        `https://api.capes.dev/load/${uuid}/optifine`,
        "https://api.capes.dev/load/NoCape/labymod",
        "https://api.capes.dev/load/NoStill/minecraft"
    ]);
    await t.throwsAsync(Skins.capeFromCapesDev("broken"), { is: error });
});
