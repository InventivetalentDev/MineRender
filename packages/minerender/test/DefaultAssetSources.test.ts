import test from "ava";
import { AssetKey, AssetLoader, AssetParser, DEFAULT_ROOT, HostedAssetSource, shutdown } from "../src";
import type { Model } from "../src";

test.after.always(() => shutdown());

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
