import test, { ExecutionContext } from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Biomes, type Biome, type BiomeColorKind } from "../src/assets/Biomes";
import { swampGrassColor } from "../src/assets/_biomes/SwampGrassColor";
import { Caching } from "../src/cache/Caching";
import { HostedAssetSource } from "../src/assets/source/HostedAssetSource";
import type { TripleArray } from "../src/model/Model";
import { BiomeBlend, validateBiomeBlendRadius } from "../src/world/_biomes/BiomeBlend";

function fixture(t: ExecutionContext) {
    const originalGet = Biomes.get, originalColor = Biomes.getColor, originalRoot = AssetLoader.ROOT;
    const colors = new Map<string, number | undefined>([["red", 0xff0102], ["blue", 0x0305ff]]);
    const calls: Array<{ id: string; kind: BiomeColorKind; root?: string }> = [];
    Biomes.get = async id => ({ temperature: 0, downfall: 0, effects: id === "swamp" ? { grass_color_modifier: "swamp" } : {} } as Biome);
    Biomes.getColor = async (id, kind, origin) => {
        calls.push({ id, kind, root: origin?.root });
        return colors.get(id);
    };
    t.teardown(() => {
        Biomes.get = originalGet;
        Biomes.getColor = originalColor;
        AssetLoader.ROOT = originalRoot;
        Caching.clear();
    });
    return { colors, calls };
}

function average(radius: number, x: number, z: number, colorAt: (x: number, z: number) => number | undefined): number | undefined {
    if (colorAt(x, z) === undefined) return undefined;
    let red = 0, green = 0, blue = 0, count = 0;
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const color = colorAt(x + dx, z + dz);
            if (color === undefined) continue;
            red += color >> 16 & 255;
            green += color >> 8 & 255;
            blue += color & 255;
            count++;
        }
    }
    return Math.floor(red / count) << 16 | Math.floor(green / count) << 8 | Math.floor(blue / count);
}

test.serial("biome blend averages sRGB bytes across signed borders and quart-height samples", async t => {
    const { colors, calls } = fixture(t);
    const biomeAt = (x: number, y: number, z: number) => (Math.floor(x / 4) + Math.floor(y / 4) + Math.floor(z / 4)) % 2 === 0 ? "red" : "blue";
    const blend = new BiomeBlend(biomeAt, 1);
    for (const radius of [1, 2, 7]) {
        blend.setRadius(radius);
        for (const position of [[0, 0, 0], [15, 3, 15], [16, 4, -1], [-16, -1, -17], [-1, -4, -1]] as TripleArray[]) {
            const [x, y, z] = position;
            t.is(await blend.getColor("water", undefined, position), average(radius, x, z, (px, pz) => colors.get(biomeAt(px, y, pz))));
        }
    }
    t.true(calls.length < 50);
});

test.serial("biome blend shares tile loads and computes each biome color once per tile", async t => {
    const { calls } = fixture(t);
    let reads = 0;
    const blend = new BiomeBlend(x => { reads++; return x < 8 ? "red" : "blue"; }, 7);
    const values = await Promise.all(Array.from({ length: 256 }, (_, i) => blend.getColor("foliage", undefined, [i % 16, 0, Math.floor(i / 16)])));
    t.is(values.length, 256);
    t.is(calls.length, 2);
    t.is(reads, 256 + 8 * 8);
    await blend.getColor("foliage", undefined, [1, 3, 1]);
    t.is(calls.length, 2);
    await blend.getColor("foliage", undefined, [1, 4, 1]);
    t.is(calls.length, 4);
    await blend.getColor("dry_foliage", undefined, [1, 4, 1]);
    t.is(calls.length, 6);
});

test.serial("radius zero performs only the center lookup and validates radius changes", async t => {
    const { calls } = fixture(t);
    let reads = 0;
    const blend = new BiomeBlend(() => { reads++; return "red"; });
    t.is(await blend.getColor("water", undefined, [-1, -1, -1]), 0xff0102);
    t.is(reads, 1);
    t.is(calls.length, 1);
    for (const radius of [-1, 8, 0.5, NaN, Infinity, -Infinity, "2" as unknown as number]) {
        t.throws(() => validateBiomeBlendRadius(radius), { message: /integer from 0 to 7/ });
        t.throws(() => new BiomeBlend(() => "red", radius), { message: /integer from 0 to 7/ });
        t.throws(() => blend.setRadius(radius), { message: /integer from 0 to 7/ });
        t.is(blend.radius, 0);
    }
    blend.setRadius(1);
    await blend.getColor("water", undefined, [0, 0, 0]);
    blend.setRadius(0);
    reads = 0;
    await blend.getColor("water", undefined, [0, 0, 0]);
    t.is(reads, 1);
});

test.serial("missing centers retain preview colors and unavailable neighbors are excluded", async t => {
    const { colors, calls } = fixture(t);
    const blend = new BiomeBlend(x => x < 0 ? undefined : "red", 7);
    t.is(await blend.getColor("water", undefined, [-1, 0, 0]), undefined);
    t.is(calls.length, 0);
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0xff0102);

    const missingColor = new BiomeBlend(x => x < 0 ? "red" : "missing", 1);
    t.is(await missingColor.getColor("water", undefined, [-1, 0, 0]), 0xff0102);
    t.is(await missingColor.getColor("water", undefined, [0, 0, 0]), undefined);
    colors.set("missing", 0x0305ff);
    t.is(await missingColor.getColor("water", undefined, [0, 0, 0]), average(1, 0, 0, x => colors.get(x < 0 ? "red" : "missing")));
});

test.serial("swamp grass averages coordinate-dependent colors without per-sample asset loads", async t => {
    const { calls } = fixture(t);
    const blend = new BiomeBlend(() => "swamp", 7);
    for (const [x, z] of [[16, 16], [-16, -16], [47, -18], [2345, 2345]]) {
        t.is(await blend.getColor("grass", undefined, [x, 0, z]), average(7, x, z, swampGrassColor));
    }
    t.is(calls.length, 0);
});

test.serial("biome tiles isolate roots and reload after shared cache clearing", async t => {
    const { calls, colors } = fixture(t);
    const blend = new BiomeBlend(() => "red", 1);
    const origin = (root: string) => new AssetKey("minecraft", "grass_block", "blockstates", undefined, "assets", ".json", root);
    await blend.getColor("water", origin("https://assets.example/first"), [0, 0, 0]);
    colors.set("red", 0x123456);
    t.is(await blend.getColor("water", origin("https://assets.example/first"), [0, 0, 0]), 0xff0102);
    t.is(await blend.getColor("water", origin("https://assets.example/second"), [0, 0, 0]), 0x123456);
    t.deepEqual(calls.map(call => call.root), ["https://assets.example/first", "https://assets.example/second"]);
    const generation = Caching.generation;
    Caching.clear();
    t.is(Caching.generation, generation + 1);
    t.is(await blend.getColor("water", origin("https://assets.example/first"), [0, 0, 0]), 0x123456);
    AssetLoader.ROOT = "https://assets.example/default-one";
    await blend.getColor("water", undefined, [0, 0, 0]);
    AssetLoader.ROOT = "https://assets.example/default-two";
    await blend.getColor("water", undefined, [0, 0, 0]);
    t.deepEqual(calls.slice(-2).map(call => call.root), ["https://assets.example/default-one", "https://assets.example/default-two"]);
    t.teardown(() => AssetLoader.removeSource("test-biome-blend"));
    AssetLoader.addSource("test-biome-blend", new HostedAssetSource("https://assets.example/pack-one"));
    colors.set("red", 0x654321);
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0x654321);
    AssetLoader.addSource("test-biome-blend", new HostedAssetSource("https://assets.example/pack-two"));
    colors.set("red", 0xabcdef);
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0xabcdef);
});

test.serial("column invalidation refreshes neighboring tiles while retaining distant tiles", async t => {
    const { colors, calls } = fixture(t);
    const blend = new BiomeBlend(() => "red", 1);
    const positions: TripleArray[] = [[-17, 0, -17], [-1, 0, -1], [16, 0, 16], [32, 0, 32]];
    for (const position of positions) await blend.getColor("water", undefined, position);
    colors.set("red", 0x123456);
    blend.invalidateColumn(0, 0);
    const values = await Promise.all(positions.map(position => blend.getColor("water", undefined, position)));
    t.deepEqual(values, [0xff0102, 0x123456, 0x123456, 0xff0102]);
    t.is(calls.length, 6);
    blend.setRadius(2);
    t.is(await blend.getColor("water", undefined, positions[0]), 0x123456);
    t.is(calls.length, 7);
});

test.serial("failed loads retry and invalidated pending loads cannot overwrite replacement tiles", async t => {
    fixture(t);
    let reject!: (error: Error) => void;
    let calls = 0;
    Biomes.getColor = async () => {
        calls++;
        return calls === 1 ? new Promise<number>((_, fail) => { reject = fail; }) : 0x123456;
    };
    const blend = new BiomeBlend(() => "red", 1);
    const failed = blend.getColor("water", undefined, [0, 0, 0]);
    const duplicate = blend.getColor("water", undefined, [1, 0, 0]);
    const failures = [t.throwsAsync(failed, { message: "unavailable" }), t.throwsAsync(duplicate, { message: "unavailable" })];
    reject(new Error("unavailable"));
    await Promise.all(failures);
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0x123456);
    t.is(calls, 2);

    blend.clear();
    let resolve!: (color: number) => void;
    Biomes.getColor = async () => new Promise<number>(done => { resolve = done; });
    const previous = blend.getColor("water", undefined, [0, 0, 0]);
    blend.invalidateColumn(0, 0);
    Biomes.getColor = async () => 0xabcdef;
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0xabcdef);
    resolve(0x123456);
    t.is(await previous, 0x123456);
    t.is(await blend.getColor("water", undefined, [0, 0, 0]), 0xabcdef);
});

test.serial("biome tile cache evicts least recently used entries at its bound", async t => {
    const { calls } = fixture(t);
    const blend = new BiomeBlend(() => "red", 1);
    for (let i = 0; i < 256; i++) await blend.getColor("water", undefined, [i * 16, 0, 0]);
    await blend.getColor("water", undefined, [0, 0, 0]);
    await blend.getColor("water", undefined, [4096, 0, 0]);
    t.is(calls.length, 257);
    await blend.getColor("water", undefined, [0, 0, 0]);
    t.is(calls.length, 257);
    await blend.getColor("water", undefined, [16, 0, 0]);
    t.is(calls.length, 258);
});
