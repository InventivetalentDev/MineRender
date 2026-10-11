import test, { ExecutionContext } from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Biomes, Biome } from "../src/assets/Biomes";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { MinecraftAsset } from "../src/MinecraftAsset";

const definition = (effects: Biome["effects"] = {}): Biome => ({ temperature: 0.8, downfall: 0.9, effects });

class BiomeSource extends AssetSource {
    value: unknown = definition();
    error?: Error;
    readonly calls: Array<{ key: AssetKey; parser: AssetParser | string }> = [];

    constructor() { super(); }

    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T | undefined> {
        this.calls.push({ key, parser });
        if (this.error) throw this.error;
        return this.value as T | undefined;
    }

    blocks() { return true; }
}

function fixture(t: ExecutionContext) {
    const source = new BiomeSource();
    const originalRoot = AssetLoader.ROOT, originalTexture = ModelTextures.get;
    const samples: Array<{ key: AssetKey; coordinates: number[] }> = [];
    Caching.clear();
    AssetLoader.addSource("test-biomes", source);
    ModelTextures.get = async key => ({
        width: 256, height: 256,
        data: { getImageData: (...coordinates: number[]) => {
            samples.push({ key, coordinates });
            return { data: new Uint8ClampedArray([0x12, 0x34, 0x56, 255]) };
        } }
    } as ExtractableImageData);
    t.teardown(() => {
        AssetLoader.removeSource("test-biomes");
        AssetLoader.ROOT = originalRoot;
        ModelTextures.get = originalTexture;
        Caching.clear();
    });
    return { source, samples };
}

test.serial("biome registry lookups retain namespace and selected root, coalesce loads, and clear with asset caches", async t => {
    const { source } = fixture(t);
    source.value = definition({ water_color: "#617b64" });
    const firstRoot = new AssetKey("custom", "grass_block", "blockstates", undefined, "assets", ".json", "https://assets.example/first");
    const secondRoot = new AssetKey("custom", "grass_block", "blockstates", undefined, "assets", ".json", "https://assets.example/second");
    t.deepEqual(await Promise.all([
        Biomes.getColor("custom:valley/wet", "water", firstRoot),
        Biomes.getColor("custom:valley/wet", "water", firstRoot)
    ]), [0x617b64, 0x617b64]);
    t.is(source.calls.length, 1);
    const loaded = source.calls[0];
    t.is(loaded.parser, AssetParser.JSON);
    t.deepEqual([loaded.key.namespace, loaded.key.assetType, loaded.key.type, loaded.key.path, loaded.key.rootType, loaded.key.extension, loaded.key.root],
        ["custom", "worldgen", "biome", "valley/wet", "data", ".json", firstRoot.root]);
    source.value = definition({ water_color: 0x123456 });
    t.is(await Biomes.getColor("custom:valley/wet", "water", firstRoot), 0x617b64);
    t.is(await Biomes.getColor("custom:valley/wet", "water", secondRoot), 0x123456);
    Caching.clear();
    t.is(await Biomes.getColor("custom:valley/wet", "water", firstRoot), 0x123456);

    AssetLoader.ROOT = "https://assets.example/version-one";
    t.is(await Biomes.getColor("plains", "water"), 0x123456);
    source.value = definition({ water_color: 0xabcdef });
    AssetLoader.ROOT = "https://assets.example/version-two";
    t.is(await Biomes.getColor("plains", "water"), 0xabcdef);
    t.is(source.calls.at(-1)!.key.namespace, "minecraft");
});

test.serial("biome climate samples grass, foliage, and dry foliage colormaps with float precision and clamped climate", async t => {
    const { source, samples } = fixture(t);
    const origin = new AssetKey("custom", "plant", "blockstates", undefined, "assets", ".json", "https://assets.example/pack");
    for (const kind of ["grass", "foliage", "dry_foliage"] as const) {
        t.is(await Biomes.getColor("plains", kind, origin), 0x123456);
        const sample = samples.at(-1)!;
        t.is(sample.key.toNamespacedString(), `minecraft:colormap/${kind}`);
        t.is(sample.key.root, origin.root);
        t.deepEqual(sample.coordinates, [50, 71, 1, 1]);
    }
    for (const [temperature, downfall, expected] of [[2, -0.5, [0, 255, 1, 1]], [-0.7, 2, [255, 255, 1, 1]], [2, 2, [0, 0, 1, 1]]] as const) {
        Caching.clear();
        source.value = { ...definition(), temperature, downfall };
        t.is(await Biomes.getColor("plains", "grass", origin), 0x123456);
        t.deepEqual(samples.at(-1)!.coordinates, expected);
    }
});

test.serial("biome effects bypass colormaps and dark forest modifies the chosen grass color", async t => {
    const { source, samples } = fixture(t);
    source.value = definition({ grass_color: 0, foliage_color: "#aAbBcC", dry_foliage_color: 0x7b5334, water_color: 0x617b64 });
    t.is(await Biomes.getColor("custom", "grass"), 0);
    t.is(await Biomes.getColor("custom", "foliage"), 0xaabbcc);
    t.is(await Biomes.getColor("custom", "dry_foliage"), 0x7b5334);
    t.is(await Biomes.getColor("custom", "water"), 0x617b64);
    t.is(samples.length, 0);
    Caching.clear();
    source.value = definition({ grass_color: "#123456", grass_color_modifier: "dark_forest" });
    t.is(await Biomes.getColor("custom", "grass"), 0x1d3430);
    t.is(samples.length, 0);
    Caching.clear();
    source.value = definition({ grass_color_modifier: "dark_forest" });
    t.is(await Biomes.getColor("custom", "grass"), 0x1d3430);
    t.is(samples.length, 1);
});

test.serial("swamp grass matches Minecraft 1.21.11 noise at signed world coordinates", async t => {
    const { source, samples } = fixture(t);
    source.value = definition({ grass_color_modifier: "swamp" });
    const points = [
        [0, 0, 0x6a7039], [1, 0, 0x6a7039], [16, 16, 0x4c763c], [-16, -16, 0x6a7039],
        [100, -100, 0x4c763c], [-100, 100, 0x4c763c], [2345, 2345, 0x6a7039],
        [-30000000, 29999999, 0x6a7039], [47, -18, 0x6a7039], [-1, -1, 0x6a7039]
    ];
    for (const [x, z, expected] of points) t.is(await Biomes.getColor("swamp", "grass", undefined, x, z), expected);
    t.is(source.calls.length, 1);
    t.is(samples.length, 0);
});

test.serial("missing and failed biome loads retry while invalid climate and effects reject", async t => {
    const { source } = fixture(t);
    source.value = undefined;
    t.is(await Biomes.getColor("missing", "water"), undefined);
    source.value = definition({ water_color: 0x123456 });
    t.is(await Biomes.getColor("missing", "water"), 0x123456);
    source.error = new Error("registry unavailable");
    await t.throwsAsync(Biomes.getColor("failed", "water"), { message: "registry unavailable" });
    source.error = undefined;
    t.is(await Biomes.getColor("failed", "water"), 0x123456);

    for (const invalid of [null, [], { ...definition(), effects: [] }, { ...definition(), temperature: NaN },
        { ...definition(), downfall: "0.5" }, definition({ grass_color: "red" }), definition({ water_color: -1 }),
        definition({ foliage_color: 0x1000000 }), definition({ dry_foliage_color: 1.5 }),
        definition({ grass_color_modifier: "unknown" } as Biome["effects"])]) {
        Caching.clear();
        source.value = invalid;
        await t.throwsAsync(Biomes.get("invalid"), { message: /Invalid biome/ });
        source.value = definition();
        t.truthy(await Biomes.get("invalid"));
    }
    t.is(await Biomes.getColor("invalid", "water"), undefined);
    await t.throwsAsync(Biomes.get("Minecraft:plains"), { message: /Invalid biome identifier/ });
});
