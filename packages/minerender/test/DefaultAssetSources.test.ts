import test from "ava";
import { AssetKey, AssetLoader, AssetParser, Requests, shutdown } from "../src";

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
