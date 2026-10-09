import test, { ExecutionContext } from "ava";
import { Color, Mesh, MeshBasicMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Biomes } from "../src/assets/Biomes";
import { Models } from "../src/assets/Models";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Materials } from "../src/Materials";
import { BlockTints } from "../src/model/block/BlockTints";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { Model } from "../src/model/Model";

const key = (path: string, namespace = "minecraft", root?: string) =>
    new AssetKey(namespace, path, "blockstates", undefined, "assets", ".json", root);

function cube(indices: Array<number | undefined> = [0]): Model {
    return {
        key: new AssetKey("test", "shared", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map((name, i) => [name, { texture: "#side", tintindex: indices[i % indices.length] }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }]
    };
}

function colormap(t: ExecutionContext) {
    const original = ModelTextures.get;
    const calls: AssetKey[] = [];
    const samples: number[][] = [];
    const fixture = { color: 0x123456, mode: "present" };
    Caching.clear();
    t.teardown(() => { ModelTextures.get = original; Caching.clear(); });
    ModelTextures.get = async assetKey => {
        calls.push(assetKey);
        if (fixture.mode === "missing") return undefined;
        return {
            width: fixture.mode === "wrong-size" ? 16 : 256, height: 256,
            data: { getImageData: (...coords: number[]) => {
                samples.push(coords);
                return { data: new Uint8ClampedArray([fixture.color >> 16, (fixture.color >> 8) & 255, fixture.color & 255, 255]) };
            } }
        } as ExtractableImageData;
    };
    return { fixture, calls, samples };
}

test.serial("fixed tints apply only to known vanilla blocks and used indices while preserving caller overrides", async t => {
    const source = colormap(t);
    const model = cube([2, -1, undefined]);
    const cases: Array<[string, number]> = [
        ["spruce_leaves", 0x619961], ["birch_leaves", 0x80a755], ["oak_leaves", 0x48b518],
        ["mangrove_leaves", 0x48b518], ["leaf_litter", 0x5c3c32], ["lily_pad", 0x71c35c],
        ["attached_melon_stem", 0xe0c71c], ["attached_pumpkin_stem", 0xe0c71c], ["water_cauldron", 0x3f76e4]
    ];
    for (const [name, color] of cases) t.deepEqual(await BlockTints.get(key(name), {}, model), { 2: color });
    const override = { 2: 0 };
    t.deepEqual(await BlockTints.get(key("spruce_leaves"), {}, model, override), { 2: 0 });
    for (const unknown of [undefined, key("oak_leaves", "custom"), key("custom_oak_leaves"), key("stone")]) {
        t.is(await BlockTints.get(unknown, {}, model), undefined);
        t.deepEqual(await BlockTints.get(unknown, {}, model, override), override);
    }
    t.deepEqual(override, { 2: 0 });
    t.is(source.calls.length, 0);
});

test.serial("grass samples its selected asset root only when needed and flowers leave index zero untinted", async t => {
    const { calls, samples } = colormap(t);
    const grass = key("grass_block", "minecraft", "https://assets.example/pack");
    const model = cube([0, 1]);
    t.is(await BlockTints.get(grass, {}, cube([-1, undefined])), undefined);
    t.deepEqual(await BlockTints.get(grass, {}, model, { 0: 0, 1: 0xabcdef }), { 0: 0, 1: 0xabcdef });
    t.is(await BlockTints.get(key("pink_petals"), {}, cube()), undefined);
    t.is(calls.length, 0);

    t.deepEqual(await BlockTints.get(grass, {}, model, { 0: 0 }), { 0: 0, 1: 0x123456 });
    t.is(calls[0].toNamespacedString(), "minecraft:colormap/grass");
    t.is(calls[0].extension, ".png");
    t.is(calls[0].root, grass.root);
    t.deepEqual(samples[0], [127, 127, 1, 1]);
    t.deepEqual(await BlockTints.get(key("pink_petals"), {}, model), { 1: 0x123456 });
    t.deepEqual(await BlockTints.get(key("wildflowers"), {}, model, { 0: 0 }), { 0: 0, 1: 0x123456 });
});

test.serial("grass samples are cached per root, cleared with other caches, and retried after missing or invalid images", async t => {
    const { fixture, calls } = colormap(t);
    const first = key("grass_block", "minecraft", "https://assets.example/first");
    const second = key("grass_block", "minecraft", "https://assets.example/second");
    const model = cube();
    t.deepEqual(await BlockTints.get(first, {}, model), { 0: 0x123456 });
    fixture.color = 0xabcdef;
    t.deepEqual(await BlockTints.get(first, {}, model), { 0: 0x123456 });
    t.is(calls.length, 1);
    t.deepEqual(await BlockTints.get(second, {}, model), { 0: 0xabcdef });
    Caching.clear();
    t.deepEqual(await BlockTints.get(first, {}, model), { 0: 0xabcdef });

    for (const mode of ["missing", "wrong-size"]) {
        Caching.clear();
        fixture.mode = mode;
        await t.throwsAsync(BlockTints.get(first, {}, model), { message: /colormap/i });
        fixture.mode = "present";
        t.deepEqual(await BlockTints.get(first, {}, model), { 0: 0xabcdef });
    }
});

test.serial("redstone power and stem age choose state-dependent colors", async t => {
    const model = cube();
    for (const [power, color] of [[0, 0x4c0000], [13, 0xea0600], [15, 0xff3200]]) {
        t.deepEqual(await BlockTints.get(key("redstone_wire"), { power: String(power) }, model), { 0: color });
    }
    for (const name of ["melon_stem", "pumpkin_stem"]) {
        t.deepEqual(await BlockTints.get(key(name), { age: "0" }, model), { 0: 0x00ff00 });
        t.deepEqual(await BlockTints.get(key(name), { age: "7" }, model), { 0: 0xe0c71c });
    }
});

test.serial("biome colors replace eligible preview colors without changing fixed colors or explicit tints", async t => {
    const { calls } = colormap(t);
    const model = cube([0, 1]);
    for (const name of ["grass_block", "sugar_cane", "oak_leaves", "mangrove_leaves", "leaf_litter", "water_cauldron"]) {
        t.deepEqual(await BlockTints.get(key(name), {}, model, undefined, 0xabcdef), { 0: 0xabcdef, 1: 0xabcdef });
        t.deepEqual(await BlockTints.get(key(name), {}, model, { 0: 0 }, 0xabcdef), { 0: 0, 1: 0xabcdef });
    }
    for (const name of ["pink_petals", "wildflowers"]) {
        t.deepEqual(await BlockTints.get(key(name), {}, model, undefined, 0xabcdef), { 1: 0xabcdef });
        t.deepEqual(await BlockTints.get(key(name), {}, model, { 0: 0 }, 0xabcdef), { 0: 0, 1: 0xabcdef });
    }
    for (const [name, color] of [["spruce_leaves", 0x619961], ["birch_leaves", 0x80a755], ["lily_pad", 0x71c35c],
        ["attached_melon_stem", 0xe0c71c], ["redstone_wire", 0x4c0000], ["melon_stem", 0x00ff00]] as const) {
        t.deepEqual(await BlockTints.get(key(name), {}, cube(), undefined, 0xabcdef), { 0: color });
    }
    t.is(await BlockTints.get(key("stone"), {}, model, undefined, 0xabcdef), undefined);
    t.deepEqual(await BlockTints.get(key("sugar_cane"), {}, cube()), { 0: 0xffffff });
    t.is(calls.length, 0);
});

test.serial("biome lookups use each block's tint rule, asset root and position without requesting fixed or unknown colors", async t => {
    const original = Biomes.getColor;
    const calls: Parameters<typeof Biomes.getColor>[] = [];
    Biomes.getColor = async (...args) => { calls.push(args); return args[0] === "test:missing" ? undefined : 0x123456; };
    t.teardown(() => { Biomes.getColor = original; });
    for (const [name, kind] of [["grass_block", "grass"], ["sugar_cane", "grass"], ["pink_petals", "grass"], ["oak_leaves", "foliage"],
        ["mangrove_leaves", "foliage"], ["leaf_litter", "dry_foliage"], ["water_cauldron", "water"]] as const) {
        const block = key(name, "minecraft", "https://assets.example/pack");
        t.is(await BlockTints.getBiomeColor(block, "test:biome", [-17, -2, 23]), 0x123456);
        t.deepEqual(calls.at(-1), ["test:biome", kind, block, -17, 23]);
    }
    t.is(await BlockTints.getBiomeColor(key("oak_leaves"), "test:missing"), undefined);
    const count = calls.length;
    for (const block of [undefined, key("stone"), key("spruce_leaves"), key("birch_leaves"), key("lily_pad"),
        key("redstone_wire"), key("melon_stem"), key("oak_leaves", "test")]) {
        t.is(await BlockTints.getBiomeColor(block, "test:biome"), undefined);
    }
    t.is(await BlockTints.getBiomeColor(key("grass_block")), undefined);
    t.is(calls.length, count);
});

test.serial("standalone blocks do not load unused biome colors when tints are explicit or absent from the model", async t => {
    const originals = { model: Models.getMerged, atlas: UVMapper.getAtlas, material: Materials.getImage,
        shaded: Materials.createShadedCanvasMaterial, biome: Biomes.getColor };
    const material = new MeshBasicMaterial(), scene = new MineRenderScene();
    let model = cube([0, 1]);
    const image = { width: 16, height: 16, canvas: {} } as CanvasImage;
    Caching.clear();
    Models.getMerged = async () => model;
    UVMapper.getAtlas = async value => new TextureAtlas(value, image, { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    Biomes.getColor = async () => { throw new Error("The model does not need a biome color"); };
    t.teardown(() => {
        Models.getMerged = originals.model;
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        Materials.createShadedCanvasMaterial = originals.shaded;
        Biomes.getColor = originals.biome;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    const blockstate = { key: key("grass_block"), variants: { "": { model: "test:block/shared" } } };
    const first = await scene.addBlock(blockstate, { applyDefaultState: false, instanceMeshes: false,
        biome: "test:unavailable", tints: { 0: 0, 1: 0xabcdef } }) as BlockObject;
    const colors = ((first["_models"][0] as ModelObject).children[0] as Mesh).geometry.getAttribute("color");
    t.is(new Color().fromBufferAttribute(colors, 0).getHex(), 0);
    t.is(new Color().fromBufferAttribute(colors, 4).getHex(), 0xabcdef);
    model = cube([-1, undefined]);
    const second = await scene.addBlock(blockstate, { applyDefaultState: false, instanceMeshes: false,
        biome: "test:unavailable" }) as BlockObject;
    const plain = ((second["_models"][0] as ModelObject).children[0] as Mesh).geometry.getAttribute("color");
    t.is(plain, undefined);
});

test.serial("changing block state updates automatic colors without recoloring another shared instance", async t => {
    const originals = { model: Models.getMerged, atlas: UVMapper.getAtlas, material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    Caching.clear();
    t.teardown(() => {
        Models.getMerged = originals.model;
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        Materials.createShadedCanvasMaterial = originals.shaded;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    const model = cube();
    const image = { width: 16, height: 16, canvas: {} } as CanvasImage;
    const atlas = new TextureAtlas(model, image, { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    Models.getMerged = async () => model;
    UVMapper.getAtlas = async () => atlas;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    const blockstate = { key: key("redstone_wire"), variants: {
        "power=0": { model: "test:block/shared" }, "power=15": { model: "test:block/shared" }
    } };
    const first = await scene.addBlock(blockstate, { applyDefaultState: false }) as BlockObject;
    const second = await scene.addBlock(blockstate, { applyDefaultState: false }) as BlockObject;
    await first.setState({ power: "0" });
    await second.setState({ power: "0" });
    t.is(scene.children.length, 1);
    const unpowered = scene.children[0] as ModelObject;
    const color = (object: ModelObject) => new Color().fromBufferAttribute((object.children[0] as Mesh).geometry.getAttribute("color"), 0).getHex();
    t.is(color(unpowered), 0x4c0000);
    t.is(unpowered.instanceCounter, 2);

    await first.setState({ power: "15" });
    t.is(scene.children.length, 2);
    const powered = scene.children[1] as ModelObject;
    t.is(color(powered), 0xff3200);
    t.is(color(unpowered), 0x4c0000);
    t.throws(() => unpowered.getScaleAt(0), { message: "Instance is not active" });
    t.is(unpowered.instanceCounter, 1);
    t.deepEqual(unpowered.getScaleAt(1).toArray(), [1, 1, 1]);
    t.is(powered.textureAtlas, unpowered.textureAtlas);
});
