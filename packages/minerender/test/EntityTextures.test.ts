import test from "ava";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import entityTextures from "../src/entity/entityTextures.json";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { ModelPart } from "../src/model/ModelPart";
import type { TextureAsset } from "../src/model/Model";
import type { Maybe } from "../src/util";

class TextureSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey) => Maybe<TextureAsset>) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<Maybe<T>> { return this.load(key) as Maybe<T>; }
}

const part: ModelPart = {
    textureWidth: 48, textureHeight: 24, textureOffsetU: 0, textureOffsetV: 12,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0,
    mirror: false, cubes: [], children: []
};
const parts = { body: { ...part, children: [{ ...part, children: [{ ...part }] }] } };
const baseParts = { leg: part };
const definitions = {
    "custom:beast": [
        { path: "beast/legacy" },
        { path: "beast/modern", textureWidth: 96, textureHeight: 48 }
    ],
    "custom:beast/arctic": [
        { path: "beast/arctic_old" },
        { path: "painted:beast/arctic", textureWidth: 120, textureHeight: 60 }
    ]
};
const originalModels = Entities.getEntityModels;
let defaults: Array<{ name: string; source: AssetSource }>;

test.beforeEach(() => {
    Caching.clear();
    defaults = [];
    for (const name of ["mcassets", "mcassets-fallback"]) {
        const source = AssetLoader.removeSource(name);
        if (source) defaults.push({ name, source });
    }
    Entities.getEntityModels = async () => ({
        "custom:beast": baseParts, "custom:beast/arctic": parts, "custom:unannotated": parts
    });
    Object.assign(entityTextures, definitions);
});
test.afterEach.always(() => {
    for (const name of ["test-assets", "test-pack"]) AssetLoader.removeSource(name);
    for (const { name, source } of defaults.reverse()) AssetLoader.addSource(name, source);
    Entities.getEntityModels = originalModels;
    for (const name of Object.keys(definitions)) Reflect.deleteProperty(entityTextures, name);
    Caching.clear();
});

function texture(): TextureAsset {
    return { width: 240, height: 120, type: "png", data: Buffer.from([1]) };
}

test.serial("nested custom models use metadata paths and recursively apply logical atlas dimensions", async t => {
    let calls = 0;
    AssetLoader.addSource("test-assets", new TextureSource(key => {
        calls++;
        return key.namespace === "painted" && key.path === "beast/arctic" ? texture() : undefined;
    }));
    const modelKey = new BasicAssetKey("custom", "beast/arctic");
    const entity = (await Entities.getEntity(modelKey))!;
    t.is(entity.key?.namespace, "painted");
    t.is(entity.key?.path, "beast/arctic");
    const body = entity.parts!.body;
    for (const resized of [body, body.children[0], body.children[0].children[0]]) {
        t.is(resized.textureWidth, 120);
        t.is(resized.textureHeight, 60);
        t.is(resized.textureOffsetV, 12);
    }
    t.is(parts.body.textureWidth, 48);
    t.is(parts.body.children[0].children[0].textureHeight, 24);
    const count = calls;
    t.is((await ModelTextures.preload(entity.key as AssetKey))?.key, entity.key);
    await Entities.getEntity(modelKey);
    t.is(calls, count);
    const explicitKey = new AssetKey("custom", "beast/arctic_old", "textures", "entity", "assets", ".png");
    t.is((await Entities.getEntity(modelKey, explicitKey))?.key, explicitKey);
    t.is(calls, count);
    t.is(await ModelTextures.preload(explicitKey), undefined);
    t.is(calls, count + 1);
});

test.serial("a legacy texture in a higher-priority pack keeps the original atlas dimensions", async t => {
    let lowerCalls = 0;
    AssetLoader.addSource("test-assets", new TextureSource(() => { lowerCalls++; return texture(); }));
    AssetLoader.addSource("test-pack", new TextureSource(key => key.path === "beast/legacy" ? texture() : undefined));
    const entity = (await Entities.getEntity(new BasicAssetKey("custom", "beast")))!;
    t.is(entity.key?.path, "beast/legacy");
    t.is(entity.parts, baseParts);
    t.is(entity.parts?.leg.textureHeight, 24);
    t.is(lowerCalls, 0);
});

test.serial("explicit keys and variant paths apply only matching metadata without probing textures", async t => {
    AssetLoader.addSource("test-assets", new TextureSource(() => { throw new Error("unexpected texture lookup"); }));
    const modelKey = new BasicAssetKey("custom", "beast");
    const modernKey = new BasicAssetKey("custom", "beast/modern");
    for (const entity of [await Entities.getEntity(modernKey), await Entities.getEntity(modelKey, modernKey)]) {
        t.is(entity?.key, modernKey);
        t.is(entity?.parts?.leg.textureWidth, 96);
        t.is(entity?.parts?.leg.textureHeight, 48);
    }
    const otherKey = new BasicAssetKey("other", modernKey.path);
    const other = await Entities.getEntity(modelKey, otherKey);
    t.is(other?.key, otherKey);
    t.is(other?.parts, baseParts);
    t.is(part.textureHeight, 24);
});

test.serial("models without texture metadata retain their existing keys and parts", async t => {
    AssetLoader.addSource("test-assets", new TextureSource(() => { throw new Error("unexpected texture lookup"); }));
    const modelKey = new BasicAssetKey("custom", "unannotated");
    const entity = await Entities.getEntity(modelKey);
    t.is(entity?.key, modelKey);
    t.is(entity?.parts, parts);
});

test.serial("texture source failures reject entity resolution without trying lower sources", async t => {
    const failure = new Error("texture source unavailable");
    let lowerCalls = 0;
    AssetLoader.addSource("test-assets", new TextureSource(() => { lowerCalls++; return texture(); }));
    AssetLoader.addSource("test-pack", new TextureSource(() => { throw failure; }));
    await t.throwsAsync(Entities.getEntity(new BasicAssetKey("custom", "beast")), { is: failure });
    t.is(lowerCalls, 0);
});
