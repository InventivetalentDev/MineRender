import test from "ava";
import { AssetKey, AssetLoader, AssetParser, DEFAULT_ROOT, HostedAssetSource, Requests, shutdown } from "../src";
import type { Model } from "../src";

test.after.always(() => shutdown());

test.serial("changing the version updates hosted requests and serialized asset keys", async t => {
    const originalRoot = AssetLoader.ROOT;
    const originalSources = [...AssetLoader["_SOURCES"]];
    const originalRequest = Requests.mcAssetRequest;
    t.teardown(() => {
        AssetLoader.ROOT = originalRoot;
        AssetLoader["_SOURCES"] = originalSources;
        Requests.mcAssetRequest = originalRequest;
    });

    const urls: string[] = [];
    Requests.mcAssetRequest = async request => {
        urls.push(request.url);
        return { data: {}, status: 200, statusText: "OK", headers: new Headers(), url: request.url };
    };
    const key = new AssetKey("minecraft", "stone", "models", "block");
    const originalKey = key.serialize();
    await AssetLoader.get(key, AssetParser.MODEL);

    AssetLoader.setVersion("1.20.4");
    await AssetLoader.get(key, AssetParser.MODEL);

    t.is(AssetLoader.version, "1.20.4");
    t.deepEqual(urls, [
        `${originalRoot}/assets/minecraft/models/block/stone.json`,
        "https://assets.mcasset.cloud/1.20.4/assets/minecraft/models/block/stone.json"
    ]);
    t.not(key.serialize(), originalKey);
    t.is(key.serialize(), "https://assets.mcasset.cloud/1.20.4/assets/models/block/minecraft/stone");
});

test("the fallback provider does not reload a vanilla cube from the primary CDN", async t => {
    const roots: string[] = [];
    const fallback = "https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master";
    const cube = '{"elements":[{"from":[0,0,0],"to":[16,16,16]}]}';

    for (const name of ["mcassets-fallback", "mcassets"]) {
        const source = AssetLoader.removeSource(name) as HostedAssetSource;
        AssetLoader.addSource(name, source);
        const originalLoad = source["load"];
        t.teardown(() => { source["load"] = originalLoad; });
        source["load"] = async key => {
            const root = key.root ?? source.root;
            roots.push(root);
            return root === DEFAULT_ROOT ? JSON.parse(cube) : undefined;
        };
    }

    const key = new AssetKey("minecraft", "cube", "models", "block");
    const assets = await AssetLoader.getAll<Model>(key, AssetParser.MODEL);
    t.is(assets.length, 1);
    t.is(assets[0].elements?.length, 1);
    t.deepEqual(roots, [DEFAULT_ROOT, fallback]);
});
