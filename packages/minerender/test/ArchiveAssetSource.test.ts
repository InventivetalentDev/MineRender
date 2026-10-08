import test from "ava";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { AssetKey, AssetLoader, AssetParser, AssetSource, shutdown } from "../src";
import { AssetLoadError } from "../src/assets/source/AssetSource";
import { ArchiveAssetSource, type ArchiveAssetSourceOptions } from "../src/assets/source/archive/ArchiveAssetSource";
import { PackFormats } from "../src/assets/source/archive/PackFormats";
import type { ArchiveProxy } from "../src/assets/source/archive/ArchiveProxy";
import type { MinecraftAsset, Maybe } from "../src";

function archive(files: Record<string, unknown>, options: ArchiveAssetSourceOptions = {}): ArchiveAssetSource {
    return new ArchiveAssetSource({
        id: "fixture",
        getEntries: async () => Object.keys(files).map(filename => ({
            filename, directory: false,
            getData: async () => new Blob([JSON.stringify(files[filename])])
        }))
    }, options);
}

class LowerSource extends AssetSource {
    calls: string[] = [];
    constructor() { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<Maybe<T>> {
        this.calls.push(key.toNamespacedString());
        return { source: "lower" } as unknown as T;
    }
}

const key = (name = "stone") => AssetKey.parse("models", `block/${name}`);
const originalSources = [...AssetLoader["_SOURCES"]];
const originalRoot = AssetLoader.ROOT;
test.beforeEach(() => { AssetLoader["_SOURCES"] = []; });
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    AssetLoader.ROOT = originalRoot;
});
test.after.always(() => shutdown());

test.serial("the public blob factory resolves overlays from a ZIP resource pack", async t => {
    const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false, useCompressionStream: false });
    await zip.add("pack.mcmeta", new TextReader(JSON.stringify({ overlays: { entries: [{ directory: "modern", formats: 75 }] } })));
    await zip.add("assets/minecraft/models/block/stone.json", new TextReader('{"source":"base"}'));
    await zip.add("modern/assets/minecraft/models/block/stone.json", new TextReader('{"source":"overlay"}'));
    const source = ArchiveAssetSource.blob(await zip.close(), { resourcePackFormat: 75 });
    t.deepEqual(await source.get(key(), AssetParser.JSON), { source: "overlay" });
});

test.serial("matching overlays override earlier overlays and base files before lower sources", async t => {
    const source = archive({
        "pack.mcmeta": { overlays: { entries: [
            { directory: "early", formats: [18, 75] },
            { directory: "late", min_format: [75, 0], max_format: [75, 1] },
            { directory: "future", min_format: 76, max_format: 76 }
        ] } },
        "assets/minecraft/models/block/stone.json": { source: "base" },
        "early/assets/minecraft/models/block/stone.json": { source: "early" },
        "late/assets/minecraft/models/block/stone.json": { source: "late" },
        "future/assets/minecraft/models/block/stone.json": { source: "future" },
        "early/assets/minecraft/models/block/dirt.json": { source: "early" },
        "assets/minecraft/models/block/grass_block.json": { source: "base" }
    }, { resourcePackFormat: [75, 1] });
    const lower = new LowerSource();
    AssetLoader.addSource("lower", lower);
    AssetLoader.addSource("pack", source);
    t.deepEqual(await AssetLoader.get(key(), AssetParser.JSON), { source: "late" });
    t.deepEqual(await AssetLoader.get(key("dirt"), AssetParser.JSON), { source: "early" });
    t.deepEqual(await AssetLoader.get(key("grass_block"), AssetParser.JSON), { source: "base" });
    t.deepEqual(await AssetLoader.get(key("missing"), AssetParser.JSON), { source: "lower" });
    t.deepEqual(lower.calls, ["minecraft:block/missing"]);
});

test.serial("archive filters block lower resources but keep their own assets and unrelated keys", async t => {
    const source = archive({
        "pack.mcmeta": { filter: { block: [{ namespace: "^minecraft$", path: "^models/block/stone\\.json$" }] } },
        "assets/minecraft/models/block/dirt.json": { source: "pack" }
    });
    const lower = new LowerSource();
    AssetLoader.addSource("lower", lower);
    AssetLoader.addSource("pack", source);
    t.is(await AssetLoader.get(key(), AssetParser.JSON), undefined);
    t.deepEqual(lower.calls, []);
    t.deepEqual(await AssetLoader.get(key("dirt"), AssetParser.JSON), { source: "pack" });
    t.deepEqual(await AssetLoader.get(AssetKey.parse("models", "custom:block/stone"), AssetParser.JSON), { source: "lower" });
});

test.serial("font collection sees one overlayed file per archive and stops at its filter", async t => {
    const source = archive({
        "pack.mcmeta": {
            overlays: { entries: [{ directory: "overlay", formats: 75 }] },
            filter: { block: [{ path: "^font/default\\.json$" }] }
        },
        "assets/minecraft/font/default.json": { providers: [{ type: "space", advances: { A: 1 } }] },
        "overlay/assets/minecraft/font/default.json": { providers: [{ type: "space", advances: { A: 2 } }] }
    }, { resourcePackFormat: 75 });
    const lower = new LowerSource();
    AssetLoader.addSource("lower", lower);
    AssetLoader.addSource("pack", source);
    t.deepEqual(await AssetLoader.getAll(AssetKey.parse("font", "default"), AssetParser.JSON), [
        { providers: [{ type: "space", advances: { A: 2 } }] }
    ]);
    t.deepEqual(lower.calls, []);
});

test.serial("resource and data overlays use separate target formats and only root pack metadata", async t => {
    const source = archive({
        "pack.mcmeta": { overlays: { entries: [{ directory: "overlay", min_format: 75, max_format: 75 }] } },
        "assets/minecraft/models/block/stone.json": { source: "base" },
        "overlay/assets/minecraft/models/block/stone.json": { source: "overlay" },
        "data/minecraft/test.json": { source: "base" },
        "overlay/data/minecraft/test.json": { source: "overlay" },
        "overlay/pack.mcmeta": { filter: { block: [{}] } }
    }, { resourcePackFormat: 75, dataPackFormat: 94 });
    t.deepEqual(await source.get(key(), AssetParser.JSON), { source: "overlay" });
    t.deepEqual(await source.get(new AssetKey("minecraft", "test", undefined, undefined, "data"), AssetParser.JSON), { source: "base" });
    t.false(await source.blocks(key()));
});

test.serial("metadata is read once while version changes select new overlays and cache scopes", async t => {
    const originalGet = PackFormats.get;
    const formats: string[] = [];
    PackFormats.get = async version => { formats.push(version); return version === "1.20.4" ? 22 : 75; };
    t.teardown(() => { PackFormats.get = originalGet; });
    let metadataReads = 0;
    const source = archive({
        "pack.mcmeta": { overlays: { entries: [{ directory: "overlay", formats: 75 }] } },
        "assets/minecraft/models/block/stone.json": { source: "base" },
        "overlay/assets/minecraft/models/block/stone.json": { source: "overlay" }
    });
    const entries = await source.getEntries();
    const metadata = entries.find(entry => entry.filename === "pack.mcmeta")!;
    const getData = metadata.getData;
    metadata.getData = async () => { metadataReads++; return getData(); };
    AssetLoader.setVersion("1.21.11");
    const scope = source.cacheId;
    t.deepEqual(await source.get(key(), AssetParser.JSON), { source: "overlay" });
    AssetLoader.setVersion("1.20.4");
    t.deepEqual(await source.get(key(), AssetParser.JSON), { source: "base" });
    t.not(source.cacheId, scope);
    t.deepEqual(formats, ["1.21.11", "1.20.4"]);
    t.is(metadataReads, 1);
    t.not(archive({}, { resourcePackFormat: 75 }).cacheId, archive({}, { resourcePackFormat: 22 }).cacheId);
});

test.serial("metadata-free archives need no version lookup and share the archive index", async t => {
    const originalGet = PackFormats.get;
    PackFormats.get = async () => { throw new Error("Unexpected format lookup"); };
    t.teardown(() => { PackFormats.get = originalGet; });
    let reads = 0;
    const proxy: ArchiveProxy = { getEntries: async () => {
        reads++;
        return [{ filename: "assets/minecraft/models/block/stone.json", directory: false,
            getData: async () => new Blob(['{"source":"base"}']) }];
    } };
    const source = new ArchiveAssetSource(proxy);
    const results = await Promise.all([source.get(key(), AssetParser.JSON), source.get(key(), AssetParser.JSON)]);
    t.deepEqual(results, [{ source: "base" }, { source: "base" }]);
    t.is(reads, 1);
    t.false(await source.blocks(key()));
});

test.serial("custom asset roots bypass pack overlays, filters and metadata parsing", async t => {
    const source = archive({
        "pack.mcmeta": { filter: { block: "invalid" } },
        "entity-models/minecraft/pig.json": { source: "custom" }
    });
    const entityKey = new AssetKey("minecraft", "pig", undefined, undefined, "entity-models");
    t.deepEqual(await source.get(entityKey, AssetParser.JSON), { source: "custom" });
    t.false(await source.blocks(entityKey));
});

test.serial("metadata and index failures reject with context and can be retried", async t => {
    let reads = 0;
    let metadata = "{";
    const source = new ArchiveAssetSource({ getEntries: async () => {
        if (++reads === 1) throw new Error("archive temporarily unavailable");
        return [{ filename: "pack.mcmeta", directory: false, getData: async () => new Blob([metadata]) }];
    } });
    const lower = new LowerSource();
    AssetLoader.addSource("lower", lower);
    AssetLoader.addSource("pack", source);
    for (let attempt = 0; attempt < 2; attempt++) {
        const error = await t.throwsAsync(AssetLoader.get(key(), AssetParser.JSON), { instanceOf: AssetLoadError });
        t.is((error as AssetLoadError).path, "pack.mcmeta");
    }
    t.deepEqual(lower.calls, []);
    metadata = "{}";
    t.deepEqual(await AssetLoader.get(key(), AssetParser.JSON), { source: "lower" });
    t.is(reads, 2);
});
