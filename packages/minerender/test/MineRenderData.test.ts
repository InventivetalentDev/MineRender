import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { MineRenderData } from "../src/assets/MineRenderData";
import { AssetSource } from "../src/assets/source/AssetSource";
import { HostedAssetSource } from "../src/assets/source/HostedAssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { Requests, RequestError } from "../src/request/Requests";
import { shutdown } from "../src/shutdown";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import { mineRenderDataManifest } from "./helpers/minerender-data";

class DataSource extends AssetSource {
    constructor(private readonly id: string, private readonly load: (key: AssetKey) => unknown | Promise<unknown>) { super(); }
    get cacheId(): string { return this.id; }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<T | undefined> { return await this.load(key) as T | undefined; }
}

let sources: typeof AssetLoader["_SOURCES"];
let root: string;
const request = Requests.mcAssetRequest;
test.beforeEach(() => {
    sources = [...AssetLoader["_SOURCES"]];
    root = AssetLoader.ROOT;
    AssetLoader["_SOURCES"] = [];
    Requests.mcAssetRequest = async () => { throw new Error("Unexpected network request"); };
    Caching.clear();
});
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = sources;
    AssetLoader.ROOT = root;
    Requests.mcAssetRequest = request;
    Caching.clear();
});
test.after.always(() => shutdown());

test.serial("exact versions share pending registry loads and clear with the asset caches", async t => {
    const calls: string[] = [];
    const items = { "minecraft:stone": { "minecraft:max_stack_size": 64 } };
    AssetLoader.addSource("data", new DataSource("one", key => {
        calls.push(key.path);
        t.is(key.rootType, undefined);
        t.is(key.namespace, "minerender-data");
        t.is(key.root, "https://assets.example/1.21.11");
        return key.path === "manifest" ? mineRenderDataManifest() : items;
    }));
    const load = () => MineRenderData.get("itemDefaults", "https://assets.example/1.21.11");
    t.deepEqual(await Promise.all([load(), load()]), [items, items]);
    t.is((await MineRenderData.resolve("https://assets.example/1.21.11")).version, "1.21.11");
    t.deepEqual(calls, ["manifest", "item-defaults"]);
    Caching.clear();
    t.deepEqual(await load(), items);
    t.deepEqual(calls, ["manifest", "item-defaults", "manifest", "item-defaults"]);
});

test.serial("missing releases select the nearest patch, older ties, then an earlier or oldest published release", async t => {
    const published = ["1.16.5", "1.19.4", "1.20.1", "1.20.6", "1.21.5", "1.21.11", "26.1.2"];
    const calls: string[] = [];
    AssetLoader.addSource("data", new DataSource("releases", key => {
        calls.push(`${key.root}/${key.path}`);
        if (key.path === "versions") return { versions: published.map(name => ({ name })) };
        const version = key.root!.split("/").pop()!;
        return published.includes(version) ? mineRenderDataManifest(version) : undefined;
    }));
    for (const [requested, expected] of [["1.20.4", "1.20.6"], ["1.21.8", "1.21.5"], ["1.22", "1.21.11"], ["1.18.2", "1.16.5"],
        ["1.16.4", "1.16.5"], ["1.15.2", "1.16.5"], ["1.12.2", "1.16.5"]]) {
        const resolved = await MineRenderData.resolve(`https://assets.example/${requested}`);
        t.is(resolved.requestedVersion, requested);
        t.is(resolved.version, expected);
        t.is(resolved.root, `https://assets.example/${expected}`);
    }
    t.is(calls.filter(path => path.endsWith("/versions")).length, 1);
    t.true(calls.includes("https://assets.example/versions"));
    await t.throwsAsync(MineRenderData.resolve("https://assets.example/26w01a"), { message: /26w01a.*fallback requires a release/ });
});

test.serial("fallback loads every dataset from the resolved root while preserving the requested root", async t => {
    const calls: string[] = [];
    AssetLoader.addSource("data", new DataSource("fallback", key => {
        calls.push(`${key.root}/${key.path}`);
        if (key.path === "versions") return { versions: [{ name: "1.21.5" }] };
        if (key.root === "https://mirror.example/minecraft/1.21.5") {
            return key.path === "manifest" ? mineRenderDataManifest("1.21.5") : { "minecraft:stone": { "minecraft:max_stack_size": 64 } };
        }
        return undefined;
    }));
    await MineRenderData.get("itemDefaults", "https://mirror.example/minecraft/1.21.6");
    t.deepEqual(calls, ["https://mirror.example/minecraft/1.21.6/manifest", "https://mirror.example/minecraft/versions",
        "https://mirror.example/minecraft/1.21.5/manifest", "https://mirror.example/minecraft/1.21.5/item-defaults"]);
    t.is(AssetLoader.ROOT, root);
});

test.serial("load failures and malformed manifests never trigger version fallback and remain retryable", async t => {
    let response: unknown = new Error("offline");
    const calls: string[] = [];
    AssetLoader.addSource("data", new DataSource("retry", key => {
        calls.push(key.path);
        if (response instanceof Error) throw response;
        return response;
    }));
    const load = () => MineRenderData.resolve("https://assets.example/1.21.11");
    await t.throwsAsync(load(), { message: "offline" });
    for (response of [null, {}, { ...mineRenderDataManifest(), schemaVersion: 2 }, mineRenderDataManifest("1.21.5")]) {
        await t.throwsAsync(load(), { message: /Invalid MineRender manifest/ });
    }
    response = mineRenderDataManifest();
    t.is((await load()).version, "1.21.11");
    t.true(calls.every(path => path === "manifest"));
});

test.serial("missing or malformed datasets reject without borrowing another release", async t => {
    const calls: string[] = [];
    let response: unknown;
    AssetLoader.addSource("data", new DataSource("files", key => {
        calls.push(key.path);
        return key.path === "manifest" ? mineRenderDataManifest() : response;
    }));
    const load = () => MineRenderData.get("fluids", "https://assets.example/1.21.11");
    for (response of [undefined, [], { "minecraft:water": { kind: "invalid", renderModel: false } }]) {
        await t.throwsAsync(load(), { message: /Invalid MineRender fluids data/ });
    }
    response = { "minecraft:water": { kind: "water", renderModel: false, levelProperty: "level" } };
    t.deepEqual(await load(), response);
    t.deepEqual(calls, ["manifest", "fluids", "fluids", "fluids", "fluids"]);
});

test.serial("active versions, explicit roots, and added sources have separate cached registries", async t => {
    AssetLoader.addSource("mcassets", new HostedAssetSource(AssetLoader.ROOT));
    AssetLoader.addSource("data", new DataSource("original", key => key.path === "manifest"
        ? mineRenderDataManifest((key.root ?? AssetLoader.ROOT).endsWith("1.16.5") ? "1.16.5" : "1.21.11")
        : { "minecraft:test": { version: key.root ?? AssetLoader.ROOT } }));
    AssetLoader.setVersion("1.16.5");
    t.deepEqual(await MineRenderData.get("itemDefaults"), { "minecraft:test": { version: "https://assets.mcasset.cloud/1.16.5" } });
    AssetLoader.setVersion("1.21.11");
    t.deepEqual(await MineRenderData.get("itemDefaults"), { "minecraft:test": { version: "https://assets.mcasset.cloud/1.21.11" } });
    const custom = "https://pack.example/custom";
    t.is((await MineRenderData.resolve(custom)).version, "1.21.11");
    t.deepEqual(await MineRenderData.get("itemDefaults", custom), { "minecraft:test": { version: custom } });
    AssetLoader.addSource("override", new DataSource("pack", key => key.path === "item-defaults" ? { "minecraft:test": { override: true } } : undefined));
    t.deepEqual(await MineRenderData.get("itemDefaults", custom), { "minecraft:test": { override: true } });
});

test.serial("block tint datasets accept optional biome sources and reject unknown kinds", async t => {
    let rule: Record<string, unknown> = { source: "constant", color: 0x48b518 };
    AssetLoader.addSource("data", new DataSource("biome-tints", key => key.path === "manifest"
        ? mineRenderDataManifest() : { "minecraft:oak_leaves": rule }));
    const load = () => MineRenderData.get("blockTints", "https://assets.example/1.21.11");
    t.deepEqual(await load(), { "minecraft:oak_leaves": rule });
    for (const biome of ["grass", "foliage", "dry_foliage", "water"]) {
        Caching.clear();
        rule = { ...rule, biome };
        t.deepEqual(await load(), { "minecraft:oak_leaves": rule });
    }
    Caching.clear();
    for (const biome of ["unknown", null, 1]) {
        rule = { ...rule, biome };
        await t.throwsAsync(load(), { message: /Invalid MineRender blockTints data/ });
    }
    rule = { ...rule, biome: "foliage" };
    t.deepEqual(await load(), { "minecraft:oak_leaves": rule });
});

test.serial("declared unavailable datasets reject without selecting another version", async t => {
    const manifest = mineRenderDataManifest();
    delete manifest.datasets.fluids;
    manifest.unavailable.fluids = "not extracted";
    const calls: string[] = [];
    AssetLoader.addSource("data", new DataSource("unavailable", key => {
        calls.push(key.path);
        return manifest;
    }));
    t.is((await MineRenderData.resolve("https://assets.example/1.21.11")).version, "1.21.11");
    await t.throwsAsync(MineRenderData.get("fluids", "https://assets.example/1.21.11"), { message: /fluids data is unavailable for 1.21.11: not extracted/ });
    t.deepEqual(calls, ["manifest"]);
});

test.serial("source changes during a load reject without caching a mixed registry", async t => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    AssetLoader.addSource("data", new DataSource("old", async () => {
        await waiting;
        return mineRenderDataManifest();
    }));
    const pending = MineRenderData.resolve("https://assets.example/1.21.11");
    AssetLoader.addSource("data", new DataSource("new", key => key.path === "manifest"
        ? mineRenderDataManifest() : { "minecraft:stone": { "minecraft:max_stack_size": 16 } }));
    release();
    await t.throwsAsync(pending, { message: /Asset sources changed/ });
    t.deepEqual(await MineRenderData.get("itemDefaults", "https://assets.example/1.21.11"), { "minecraft:stone": { "minecraft:max_stack_size": 16 } });
});

test.serial("hosted registry requests do not retry the default namespace or root", async t => {
    const urls: string[] = [];
    Requests.mcAssetRequest = async config => {
        urls.push(config.url);
        throw new RequestError("missing", { data: undefined, status: 404, statusText: "Not Found", headers: new Headers(), url: config.url });
    };
    const source = new HostedAssetSource("https://host.example/1.21.11");
    const key = new AssetKey("minerender-data", "manifest", undefined, undefined, undefined, ".json", "https://mirror.example/1.16.5");
    key.rootType = undefined!;
    t.is(await source.get(key, AssetParser.JSON), undefined);
    t.deepEqual(urls, ["https://mirror.example/1.16.5/minerender-data/manifest.json"]);
});

test.serial("rootless requests use a hosted source's manifest version without sharing explicit-root cache entries", async t => {
    const urls: string[] = [];
    AssetLoader.ROOT = "https://assets.example/1.21.11";
    Requests.mcAssetRequest = async config => {
        urls.push(config.url);
        const data = config.url.endsWith("manifest.json") ? mineRenderDataManifest(config.url.startsWith("https://pack.example/") ? "1.20.1" : "1.21.11")
            : { "minecraft:stone": { "minecraft:max_stack_size": config.url.startsWith("https://pack.example/") ? 16 : 64 } };
        return { data, status: 200, statusText: "OK", headers: new Headers(), url: config.url };
    };
    AssetLoader.addSource("mcassets", new HostedAssetSource(AssetLoader.ROOT));
    AssetLoader.addSource("pack", new HostedAssetSource("https://pack.example/1.20.1"));
    t.deepEqual(await MineRenderData.get("itemDefaults"), { "minecraft:stone": { "minecraft:max_stack_size": 16 } });
    const resolved = await MineRenderData.resolve();
    t.is(resolved.version, "1.20.1");
    t.is(resolved.requestedVersion, "1.21.11");
    t.is(resolved.root, AssetLoader.ROOT);
    t.deepEqual(await MineRenderData.get("itemDefaults", AssetLoader.ROOT), { "minecraft:stone": { "minecraft:max_stack_size": 64 } });
    t.deepEqual(urls, ["https://pack.example/1.20.1/minerender-data/manifest.json", "https://pack.example/1.20.1/minerender-data/item-defaults.json",
        "https://assets.example/1.21.11/minerender-data/manifest.json", "https://assets.example/1.21.11/minerender-data/item-defaults.json"]);
});
