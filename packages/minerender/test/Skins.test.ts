import test from "ava";
import { Requests } from "../src/request/Requests";
import { Skins } from "../src/skin/Skins";

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
