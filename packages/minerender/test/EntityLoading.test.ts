import test from "ava";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { Requests } from "../src/request/Requests";
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
test.beforeEach(() => {
    Caching.clear();
    AssetLoader["_SOURCES"] = [];
});
test.afterEach.always(() => {
    AssetLoader.ROOT = originalRoot;
    AssetLoader["_SOURCES"] = [...originalSources];
    Requests.mcAssetRequest = originalRequest;
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
    const first = await Entities.getEntity(key);
    const texture = new BasicAssetKey("painted", "boat/checkered");
    const saddle = await Entities.getEntity(key, texture, { layer: "saddle" });
    t.deepEqual(first, { key, layer: file.layers.main, id: file.id });
    t.is(first!.key, key);
    t.is(saddle!.key, texture);
    t.is(saddle!.layer, file.layers.saddle);
    t.deepEqual(await Entities.getBlock(key, texture, { layer: "saddle" }), saddle);
    t.deepEqual(keys, [new AssetKey("custom", "boat/oak", undefined, undefined, "entity-models", ".json")]);
    t.is(lowerCalls, 0);
    t.deepEqual(file, original);
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
    t.is((await Entities.getEntity(key, undefined, { layer: "saddle" }))!.layer, file.layers.saddle);
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

test.serial("version changes fetch entity files from the selected dataset root", async t => {
    const urls: string[] = [];
    Requests.mcAssetRequest = async request => {
        urls.push(request.url);
        return { data: model(), status: 200, statusText: "OK", headers: new Headers(), url: request.url };
    };
    const key = new BasicAssetKey("minecraft", "cow");
    AssetLoader.setVersion("1.21.11");
    const first = await Entities.getEntity(key);
    t.is((await Entities.getEntity(key))!.layer, first!.layer);
    AssetLoader.setVersion("1.20.1");
    const second = await Entities.getEntity(key);
    t.not(second!.layer, first!.layer);
    t.deepEqual(urls, [
        "https://assets.mcasset.cloud/1.21.11/entity-models/minecraft/cow.json",
        "https://assets.mcasset.cloud/1.20.1/entity-models/minecraft/cow.json"
    ]);
});
