import test from "ava";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Env, EnvProvider } from "../src/Env";
import { ImageLoader } from "../src/image/ImageLoader";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { Requests } from "../src/request/Requests";
import { EntityObject } from "../src/entity/scene/EntityObject";
import type { EntityModelFile, EntityModelPart } from "../src/entity/EntityModel";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { Maybe } from "../src/util";

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey, parser: AssetParser | string) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.load(key, parser) as Maybe<T>;
    }
}

function model(): EntityModelFile {
    const root: EntityModelPart = { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} };
    return {
        id: "minecraft:cow",
        layers: {
            main: { texture: [64, 32], root: structuredClone(root) },
            saddle: { texture: [64, 64], root: structuredClone(root) }
        }
    };
}

const originalRoot = AssetLoader.ROOT;
const originalSources = [...AssetLoader["_SOURCES"]];
const originalRequest = Requests.mcAssetRequest;
const originalDecode = ImageLoader.infoToCanvasData;
let decodedImages = 0;
const image = () => ({ width: 1, height: 1, type: "png", data: Buffer.from([1]) });
test.beforeEach(() => {
    Caching.clear();
    AssetLoader["_SOURCES"] = [];
    decodedImages = 0;
    ImageLoader.infoToCanvasData = async info => {
        decodedImages++;
        return { width: info.width, height: info.height, data: {} as CanvasRenderingContext2D };
    };
});
test.afterEach.always(() => {
    AssetLoader.ROOT = originalRoot;
    AssetLoader["_SOURCES"] = [...originalSources];
    Requests.mcAssetRequest = originalRequest;
    ImageLoader.infoToCanvasData = originalDecode;
    Caching.clear();
});

test.serial("entity files preserve nested IDs and share layers while explicit textures remain caller-owned", async t => {
    const file = model();
    file.id = "custom:boat/oak";
    const original = structuredClone(file);
    const keys: AssetKey[] = [];
    let lowerCalls = 0;
    AssetLoader.addSource("test-low", new StubSource(() => { lowerCalls++; return model(); }));
    AssetLoader.addSource("test-high", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        keys.push(key);
        return file;
    }));
    const key = new BasicAssetKey("custom", "boat/oak");
    const first = await Entities.getEntity(key, key);
    const texture = new BasicAssetKey("painted", "boat/checkered");
    const saddle = await Entities.getEntity(key, texture, { layer: "saddle" });
    t.deepEqual(first, { key, texture: new AssetKey("custom", "boat/oak", "textures", "entity", "assets", ".png"), layer: file.layers.main, id: file.id });
    t.is(first!.key, key);
    t.is(saddle!.key, texture);
    t.is(saddle!.layer, file.layers.saddle);
    t.deepEqual(await Entities.getBlock(key, texture, { layer: "saddle" }), saddle);
    t.deepEqual(keys, [new AssetKey("custom", "boat/oak", undefined, undefined, "entity-models", ".json")]);
    t.is(lowerCalls, 0);
    t.deepEqual(file, original);
});

test.serial("parsed entity and texture keys retain their complete paths", async t => {
    const file = model();
    file.id = "custom:boat/oak";
    const keys: AssetKey[] = [];
    AssetLoader.addSource("test", new StubSource(key => {
        keys.push(key);
        return key.namespace === "custom" && key.path === "boat/oak" ? file : undefined;
    }));
    const key = AssetKey.parse("entities", "custom:boat/oak");
    const entity = await Entities.getEntity(key, key);
    t.deepEqual(entity, { key, texture: new AssetKey("custom", "boat/oak", "textures", "entity", "assets", ".png"), layer: file.layers.main, id: file.id });
    t.deepEqual(keys, [new AssetKey("custom", "boat/oak", undefined, undefined, "entity-models", ".json")]);
    t.deepEqual(new EntityObject(entity!)["textureKey"], new AssetKey("custom", "boat/oak", "textures", "entity", "assets", ".png"));
    const textured = await Entities.getEntity(key, AssetKey.parse("textures", "painted:boat/checkered"));
    t.deepEqual(new EntityObject(textured!)["textureKey"], new AssetKey("painted", "boat/checkered", "textures", "entity", "assets", ".png"));
    const rootedTexture = new AssetKey("painted", "boat/checkered", "textures", "entity", "assets", ".png", "https://pack.example/custom");
    const explicit = await Entities.getEntity(key, rootedTexture);
    t.is(explicit!.texture, rootedTexture);
    t.is(new EntityObject(explicit!)["textureKey"], rootedTexture);
});

test.serial("selected layer texture locations skip probing and explicit textures take precedence", async t => {
    const file = model();
    file.layers.main.textureLocation = "minecraft:textures/entity/cow/temperate_cow.png";
    file.layers.saddle.textureLocation = "painted:textures/entity/cow/saddle.png";
    const keys: AssetKey[] = [];
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        keys.push(key);
        return file;
    }));
    const key = new BasicAssetKey("minecraft", "cow");
    const main = await Entities.getEntity(key);
    const saddle = await Entities.getEntity(key, undefined, { layer: "saddle" });
    t.deepEqual(main!.texture, new AssetKey("minecraft", "cow/temperate_cow", "textures", "entity", "assets", ".png"));
    t.deepEqual(saddle!.texture, new AssetKey("painted", "cow/saddle", "textures", "entity", "assets", ".png"));
    t.is(saddle!.layer, file.layers.saddle);

    const texture = new AssetKey("custom", "cow/checkered", "textures", "entity", "assets", ".png");
    const explicit = await Entities.getEntity(key, texture, { layer: "saddle" });
    t.is(explicit!.texture, texture);
    t.deepEqual(keys, [new AssetKey("minecraft", "cow", undefined, undefined, "entity-models", ".json")]);
    t.is(decodedImages, 0);
});

test.serial("missing layers identify the model and available layers without selecting a substitute", async t => {
    const file = model();
    delete file.layers.main;
    AssetLoader.addSource("test", new StubSource(key => key.path === "cow" ? file : undefined));
    const key = new BasicAssetKey("minecraft", "cow");
    await t.throwsAsync(Entities.getEntity(key), { message: 'Entity minecraft:cow has no layer "main". Available layers: saddle' });
    await t.throwsAsync(Entities.getEntity(key, undefined, { layer: "armor" }), {
        message: 'Entity minecraft:cow has no layer "armor". Available layers: saddle'
    });
    t.is((await Entities.getEntity(key, key, { layer: "saddle" }))!.layer, file.layers.saddle);
    t.is(await Entities.getEntity(new BasicAssetKey("minecraft", "missing")), undefined);
});

test.serial("entity lists recurse through dataset directories and return bare IDs", async t => {
    const calls: string[] = [];
    const lists = {
        _list: { files: ["cow.json", "_list.json", "README.md"], directories: ["boat"] },
        "boat/_list": { files: ["oak.json"], directories: ["cargo"] },
        "boat/cargo/_list": { files: ["bamboo.json"], directories: [] }
    };
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        t.is(key.namespace, "minecraft");
        t.is(key.rootType, "entity-models");
        t.is(key.assetType, undefined);
        t.is(parser, AssetParser.LIST);
        calls.push(key.path);
        return lists[key.path];
    }));
    const expected = ["cow", "boat/oak", "boat/cargo/bamboo"];
    t.deepEqual(await Entities.getEntityList(), expected);
    t.deepEqual(await Entities.getBlockList(), expected);
    t.deepEqual(calls, ["_list", "boat/_list", "boat/cargo/_list"]);
});

test.serial("version changes fetch entity files and resolved textures from the selected root", async t => {
    const originalProvider = Env["_provider"];
    t.teardown(() => { Env["_provider"] = originalProvider; });
    Env.register({ name: "test", imageSize: () => ({ width: 1, height: 1, type: "png" }) } as EnvProvider);
    const urls: string[] = [];
    Requests.mcAssetRequest = async request => {
        urls.push(request.url);
        return { data: request.url.endsWith(".png") ? Buffer.from([1]) : model(), status: 200, statusText: "OK", headers: new Headers(), url: request.url };
    };
    const key = new BasicAssetKey("minecraft", "cow");
    AssetLoader.setVersion("1.21.11");
    const first = await Entities.getEntity(key);
    const firstTexture = first!.texture!.serialize();
    t.is((await Entities.getEntity(key))!.layer, first!.layer);
    AssetLoader.setVersion("1.20.1");
    const second = await Entities.getEntity(key);
    t.not(second!.layer, first!.layer);
    t.not(second!.texture!.serialize(), firstTexture);
    t.is(decodedImages, 2);
    t.deepEqual(urls, [
        "https://assets.mcasset.cloud/1.21.11/entity-models/minecraft/cow.json",
        "https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/entity/cow.png",
        "https://assets.mcasset.cloud/1.20.1/entity-models/minecraft/cow.json",
        "https://assets.mcasset.cloud/1.20.1/assets/minecraft/textures/entity/cow.png"
    ]);
});


test.serial("layers without texture locations use direct or nested textures and reuse the cached resolution", async t => {
    for (const [name, path, expectedCalls] of [
        ["cow", "cow", ["minecraft:entity/cow"]],
        ["pig", "pig/pig", ["minecraft:entity/pig", "minecraft:entity/pig/pig"]]
    ] as const) {
        const calls: string[] = [];
        const file = model();
        const before = decodedImages;
        const texture = new AssetKey("minecraft", path, "textures", "entity", "assets", ".png");
        AssetLoader.addSource("test", new StubSource((key, parser) => {
            if (key.rootType === "entity-models") return file;
            t.is(parser, AssetParser.IMAGE);
            calls.push(key.toNamespacedString());
            return key.toNamespacedString() === texture.toNamespacedString() ? image() : undefined;
        }));
        const key = new BasicAssetKey("minecraft", name);
        const first = await Entities.getEntity(key);
        const second = await Entities.getEntity(key);
        t.deepEqual(first!.texture, texture);
        t.deepEqual(second!.texture, texture);
        t.deepEqual(calls, [...expectedCalls]);
        t.is(decodedImages - before, 1);
    }
});

test.serial("variant textures prefer temperate, otherwise the first file, and support wolf asset maps", async t => {
    const cases = [
        { name: "chicken", files: ["warm.json", "temperate.json"], selected: "temperate", variant: { asset_id: "custom:entity/chicken/temperate" }, texture: "custom:entity/chicken/temperate" },
        { name: "frog", files: ["_list.json", "README.md", "warm.json", "cold.json"], selected: "warm", variant: { asset_id: "custom:mob/frog/orange" }, texture: "custom:mob/frog/orange" },
        { name: "wolf", files: ["pale.json"], selected: "pale", variant: { assets: { tame: "minecraft:entity/wolf/pale_tame", wild: "minecraft:entity/wolf/pale" } }, texture: "minecraft:entity/wolf/pale" },
        { name: "wolf", files: ["snowy.json"], selected: "snowy", variant: { assets: { ignored: 42, angry: "minecraft:entity/wolf/snowy_angry", tame: "minecraft:entity/wolf/snowy_tame" } }, texture: "minecraft:entity/wolf/snowy_angry" }
    ];
    for (const entry of cases) {
        Caching.clear();
        const calls: string[] = [];
        AssetLoader.addSource("test", new StubSource((key, parser) => {
            if (key.rootType === "entity-models") return model();
            if (parser === AssetParser.IMAGE) {
                calls.push(key.toNamespacedString());
                return key.toNamespacedString() === entry.texture ? image() : undefined;
            }
            t.is(key.rootType, "data");
            t.is(key.assetType, `${entry.name}_variant`);
            calls.push(key.path);
            return parser === AssetParser.LIST ? { files: entry.files, directories: [] } : entry.variant;
        }));
        const key = new BasicAssetKey("minecraft", entry.name);
        const entity = (await Entities.getEntity(key))!;
        await Entities.getEntity(key);
        t.deepEqual(entity.texture, AssetKey.parse("textures", entry.texture));
        t.deepEqual(calls, [`minecraft:entity/${entry.name}`, `minecraft:entity/${entry.name}/${entry.name}`, "_list", entry.selected]);
        t.is(new EntityObject(entity)["textureKey"], entity.texture);
        t.truthy(await ModelTextures.get(entity.texture!));
        t.is(calls.at(-1), entry.texture);
    }
});
