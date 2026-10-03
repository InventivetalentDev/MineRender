import test from "ava";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { ModelPart } from "../src/model/ModelPart";
import type { TextureAsset } from "../src/model/Model";
import type { Maybe } from "../src/util";

class TextureSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey) => Maybe<TextureAsset>) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<Maybe<T>> { return this.load(key) as Maybe<T>; }
}

const part: ModelPart = {
    textureWidth: 64, textureHeight: 32, textureOffsetU: 0, textureOffsetV: 16,
    pivotX: 0, pivotY: 0, pivotZ: 0, pitch: 0, yaw: 0, roll: 0,
    mirror: false, cubes: [], children: []
};
const parts = { leg: part };
const oldPaths = { chicken: "chicken", pig: "pig/pig", cow: "cow/cow" };
const originalModels = Entities.getEntityModels;
let defaults: Array<{ name: string; source: AssetSource }>;

test.beforeEach(() => {
    Caching.clear();
    defaults = [];
    for (const name of ["mcassets", "mcassets-fallback"]) {
        const source = AssetLoader.removeSource(name);
        if (source) defaults.push({ name, source });
    }
    Entities.getEntityModels = async () => Object.fromEntries([
        ...Object.keys(oldPaths).map(name => [`minecraft:${name}`, parts]), ["custom:chicken", parts]
    ]);
});
test.afterEach.always(() => {
    for (const name of ["test-textures", "test-pack"]) AssetLoader.removeSource(name);
    for (const { name, source } of defaults.reverse()) AssetLoader.addSource(name, source);
    Entities.getEntityModels = originalModels;
    Caching.clear();
});

function texture(height = 32): TextureAsset {
    return { width: 64, height, type: "png", data: Buffer.from([1]) };
}

test.serial("modern farm-animal textures select the matching logical atlas height and reuse fetched bytes", async t => {
    const calls: string[] = [];
    AssetLoader.addSource("test-textures", new TextureSource(key => {
        calls.push(key.path);
        return key.path.includes("/temperate_") ? texture(key.path.startsWith("chicken/") ? 32 : 64) : undefined;
    }));
    for (const name of Object.keys(oldPaths)) {
        const modelKey = new BasicAssetKey("minecraft", name);
        const entity = (await Entities.getEntity(modelKey))!;
        t.is(entity.key?.path, `${name}/temperate_${name}`);
        t.is(entity.parts?.leg.textureHeight, name === "chicken" ? 32 : 64);
        const count = calls.length;
        const encoded = await ModelTextures.preload(entity.key as AssetKey);
        t.is(encoded?.key, entity.key);
        await Entities.getEntity(modelKey);
        t.is(calls.length, count);
    }
    t.is(part.textureHeight, 32);
});

test.serial("an old texture in a higher-priority pack keeps the legacy atlas dimensions", async t => {
    let lowerCalls = 0;
    AssetLoader.addSource("test-textures", new TextureSource(() => { lowerCalls++; return texture(64); }));
    AssetLoader.addSource("test-pack", new TextureSource(key => Object.values(oldPaths).includes(key.path) ? texture() : undefined));
    for (const [name, path] of Object.entries(oldPaths)) {
        const entity = (await Entities.getEntity(new BasicAssetKey("minecraft", name)))!;
        t.is(entity.key?.path, path);
        t.is(entity.parts, parts);
        t.is(entity.parts?.leg.textureHeight, 32);
    }
    t.is(lowerCalls, 0);
});

test.serial("explicit modern farm-animal texture paths use their atlas dimensions without probing sources", async t => {
    AssetLoader.addSource("test-textures", new TextureSource(() => { throw new Error("unexpected texture lookup"); }));
    for (const name of ["pig", "cow"]) {
        const modelKey = new BasicAssetKey("minecraft", name);
        const modernKey = new BasicAssetKey("minecraft", `${name}/temperate_${name}`);
        for (const entity of [await Entities.getEntity(modernKey), await Entities.getEntity(modelKey, modernKey)]) {
            t.is(entity?.key, modernKey);
            t.is(entity?.parts?.leg.textureHeight, 64);
            t.not(entity?.parts, parts);
        }
        for (const key of [new BasicAssetKey("minecraft", `${name}/${name}`), new BasicAssetKey("custom", modernKey.path)]) {
            const entity = await Entities.getEntity(modelKey, key);
            t.is(entity?.key, key);
            t.is(entity?.parts, parts);
            t.is(entity?.parts?.leg.textureHeight, 32);
        }
    }
    t.is(part.textureHeight, 32);
});

test.serial("implicit aliases do not replace explicit texture keys or custom namespaces, including warm caches", async t => {
    let calls = 0;
    AssetLoader.addSource("test-textures", new TextureSource(key => {
        calls++;
        return key.path === "chicken/temperate_chicken" ? texture() : undefined;
    }));
    const modelKey = new BasicAssetKey("minecraft", "chicken");
    await Entities.getEntity(modelKey);
    const count = calls;
    const explicitKey = new AssetKey("minecraft", "chicken", "textures", "entity", "assets", ".png");
    t.is((await Entities.getEntity(modelKey, explicitKey))?.key, explicitKey);
    const customKey = new BasicAssetKey("custom", "chicken");
    t.is((await Entities.getEntity(customKey))?.key, customKey);
    t.is(calls, count);
    t.is(await ModelTextures.preload(explicitKey), undefined);
    t.is(calls, count + 1);
});

test.serial("texture source failures reject entity resolution without trying lower sources", async t => {
    const failure = new Error("texture source unavailable");
    let lowerCalls = 0;
    AssetLoader.addSource("test-textures", new TextureSource(() => { lowerCalls++; return texture(); }));
    AssetLoader.addSource("test-pack", new TextureSource(() => { throw failure; }));
    await t.throwsAsync(Entities.getEntity(new BasicAssetKey("minecraft", "chicken")), { is: failure });
    t.is(lowerCalls, 0);
});
