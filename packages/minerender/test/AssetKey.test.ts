import test from "ava";
import { AssetKey, AssetLoader, BasicAssetKey, DEFAULT_ROOT, isAssetKey, isBasicAssetKey } from "../src";

test("constructing a key preserves its literal path", t => {
    const key = new AssetKey("custom", "textures/block/stone.png");
    t.is(key.path, "textures/block/stone.png");
    t.is(key.getFullPath(), "textures/block/stone.png");
    t.is(key.toNamespacedString(), "custom:textures/block/stone.png");
    t.is(key.type, undefined);
});

test("parsed references append their selected extension once and preserve unrelated dots", t => {
    const cases = [
        ["textures", "block/stone.png", "block/stone", ".png"],
        ["models", "block/nested/stone.v2.json", "block/nested/stone.v2", ".json"],
        ["models", "block/stone", "block/stone", ".json"],
        ["models", "block/stone.png", "block/stone.png", ".json"],
        ["models", "block/stone.json.json", "block/stone.json", ".json"]
    ];
    for (const [assetType, reference, path, extension] of cases) {
        const key = AssetKey.parse(assetType, `custom:${reference}`);
        t.is(key.toNamespacedString(), `custom:${path}`);
        t.is(key.extension, extension);
        t.is(key.getFullPath() + key.extension, path + extension);
    }
});

test("relative references inherit namespace, root, and non-texture extensions including an empty extension", t => {
    const root = "https://assets.example/custom";
    for (const extension of [".json", ".nbt", ""]) {
        const origin = new AssetKey("custom", "source", "models", "block", "assets", extension, root);
        const reference = `block/stone.v2${extension}`;
        const key = AssetKey.parse("models", reference, origin);
        t.is(key.namespace, "custom");
        t.is(key.root, root);
        t.is(key.extension, extension);
        t.is(key.getFullPath(), "block/stone.v2");
        t.is(key.getFullPath() + key.extension, reference);

        const texture = AssetKey.parse("textures", "other:block/stone.png", origin);
        t.is(texture.namespace, "other");
        t.is(texture.root, root);
        t.is(texture.getFullPath() + texture.extension, "block/stone.png");
        t.is(texture.extension, ".png");
    }
});

test("key guards safely reject primitives and require string namespace and path fields", t => {
    const invalid = [null, undefined, "stone", 4, false, Symbol("key"), {},
        { namespace: "minecraft" }, { namespace: 4, path: "stone" }, { namespace: "minecraft", path: 4 }];
    for (const value of invalid) {
        t.false(isBasicAssetKey(value));
        t.false(isAssetKey(value));
    }
    t.true(isBasicAssetKey(new BasicAssetKey("minecraft", "stone")));
    t.true(isBasicAssetKey({ namespace: "custom", path: "stone" }));
});

test("full-key guards recognize constructed and parsed keys without mistaking basic-key lookalikes", t => {
    for (const key of [new AssetKey("minecraft", "stone", "models", "block"), AssetKey.parse("textures", "block/stone.png")]) {
        t.true(isBasicAssetKey(key));
        t.true(isAssetKey(key));
    }
    t.false(isAssetKey(new BasicAssetKey("minecraft", "stone")));
    t.false(isAssetKey({ namespace: "minecraft", path: "stone" }));
    t.false(isAssetKey({ namespace: "minecraft", path: "stone", parse: AssetKey.parse }));
});

test.serial("cache keys include the selected root and isolate older default assets", t => {
    const key = new AssetKey("minecraft", "stone", "models", "block");
    const originalRoot = AssetLoader.ROOT;
    try {
        AssetLoader.ROOT = DEFAULT_ROOT;
        const current = key.serialize();
        t.true(current.startsWith(DEFAULT_ROOT + "/"));
        t.false(current.startsWith("__root__/"));
        t.is(current, new AssetKey("minecraft", "stone", "models", "block", "assets", ".json", DEFAULT_ROOT).serialize());

        AssetLoader.ROOT = "https://assets.mcasset.cloud/1.17.1";
        t.not(key.serialize(), current);
        t.true(key.serialize().startsWith(AssetLoader.ROOT + "/"));
    } finally {
        AssetLoader.ROOT = originalRoot;
    }
});
