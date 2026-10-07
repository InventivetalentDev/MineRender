import test, { ExecutionContext } from "ava";
import { Color, CustomBlending, Mesh, MeshBasicMaterial, NormalBlending, Object3D, OneFactor, RepeatWrapping, ZeroFactor } from "three";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import { Materials } from "../src/Materials";
import { Ticker } from "../src/Ticker";
import { EntityObject, EntityObjectOptions } from "../src/entity/scene/EntityObject";
import type { EntityLayer, EntityModelFile, EntityModelLayer, EntityModelPart, EntityRenderMode } from "../src/entity/EntityModel";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { TextureAsset } from "../src/MinecraftAsset";

const part = (): EntityModelPart => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [{ origin: [0, 0, 0], size: [2, 2, 2], uv: [0, 0] }], children: {}
});
const geometry = (render?: EntityRenderMode, textureLocation?: string): EntityModelLayer => ({
    texture: [64, 32], root: part(), ...(render && { render }), ...(textureLocation && { textureLocation })
});
const textureKey = (path: string) => new AssetKey("minecraft", path, "textures", "entity", "assets", ".png");
const canvas = {} as HTMLCanvasElement;
const modes: EntityRenderMode[] = ["cutout", "cutout_cull", "cutout_z_offset", "solid", "translucent", "translucent_emissive",
    "eyes", "energy_swirl", "breeze_wind", "water_mask"];

const originalSources = [...AssetLoader["_SOURCES"]];
const originalGet = ModelTextures.get;
const originalImage = Materials.getImage;
test.beforeEach(() => Caching.clear());
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    ModelTextures.get = originalGet;
    Materials.getImage = originalImage;
    Caching.clear();
});

/** Builds entities whose textures decode to a stub canvas and count as cached assets, so their materials are shared. */
function fixture(t: ExecutionContext) {
    const placeholder = new MeshBasicMaterial();
    const objects: EntityObject[] = [];
    Materials.getImage = () => placeholder;
    ModelTextures.get = async () => ({ width: 64, height: 32, data: { canvas } } as unknown as ExtractableImageData);
    t.teardown(() => {
        for (const object of objects) object.dispose();
        placeholder.dispose();
    });
    return async (layers: Record<string, Partial<EntityLayer>>, options?: Partial<EntityObjectOptions>) => {
        const key = new BasicAssetKey("minecraft", "fixture");
        const complete = Object.fromEntries(Object.entries(layers).map(([name, layer]) =>
            [name, { key, texture: textureKey(`entity/${name}`), layer: geometry(), ...layer }]));
        const object = new EntityObject({ ...Object.values(complete)[0], id: "minecraft:fixture", layers: complete }, options);
        objects.push(object);
        // Materials are only shared for textures that are already cached assets.
        for (const layer of Object.values(complete)) {
            await Caching.textureAssetCache.get(layer.texture.serialize(), async () => ({ key: layer.texture } as unknown as TextureAsset));
        }
        await object.init();
        return object;
    };
}

const material = (object: EntityObject, layer: string) => object.getMeshByName("root", layer)!.material as MeshBasicMaterial;

test.serial("default selection draws main and the passes of the requested state while explicit layers draw only themselves", async t => {
    const file: EntityModelFile = {
        id: "minecraft:fixture",
        layers: {
            main: geometry(undefined, "minecraft:textures/entity/fixture/body.png"),
            armor: geometry("energy_swirl", "minecraft:textures/entity/fixture/armor.png"),
            outer: geometry("translucent"),
            wool: geometry(undefined, "minecraft:textures/entity/fixture/wool.png")
        },
        passes: [
            { layer: "main", render: "eyes", textureLocation: "minecraft:textures/entity/fixture/eyes.png" },
            { layer: "armor", when: "powered" },
            { layer: "outer", textureLocation: "minecraft:textures/entity/fixture/body.png" },
            { layer: "wool", when: "not_sheared", tint: "wool_color" },
            { layer: "main", textureLocation: "minecraft:textures/entity/fixture/glow.png" }
        ]
    };
    class Source extends AssetSource {
        async get() { return file as any; }
    }
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("test", new Source());
    const key = new BasicAssetKey("minecraft", "fixture");
    const draw = (layer: string, texture: string, extra: Partial<EntityLayer> = {}) =>
        ({ key, texture: textureKey(`fixture/${texture}`), layer: file.layers[layer], ...extra });

    t.deepEqual(await Entities.getPassList(key), file.passes);
    const always = await Entities.getEntity(key);
    t.deepEqual(Object.keys(always!.layers!), ["main", "main#2", "outer", "main#3"]);
    t.deepEqual(always!.layers, {
        main: draw("main", "body"),
        "main#2": draw("main", "eyes", { render: "eyes" }),
        outer: draw("outer", "body", { render: "translucent" }),
        "main#3": draw("main", "glow")
    });
    t.is(always!.render, undefined);

    const state = await Entities.getEntity(key, undefined, { when: ["powered", "not_sheared", "unknown"] });
    t.deepEqual(Object.keys(state!.layers!), ["main", "main#2", "armor", "outer", "wool", "main#3"]);
    t.deepEqual(state!.layers!.armor, draw("armor", "armor", { render: "energy_swirl" }));
    t.deepEqual(state!.layers!.wool, draw("wool", "wool", { tint: "wool_color" }));

    const override = new BasicAssetKey("minecraft", "fixture/custom_eyes");
    const overridden = await Entities.getEntity(key, undefined, { textures: { "main#2": override } });
    t.deepEqual(overridden!.layers!["main#2"], { ...draw("main", "custom_eyes", { render: "eyes" }), key: override });

    // Explicit selections ignore passes and `when`, and keep the layer's own mode.
    const explicit = await Entities.getEntity(key, undefined, { layers: ["armor", "main"], when: ["not_sheared"] });
    t.deepEqual(explicit!.layers, { armor: draw("armor", "armor", { render: "energy_swirl" }), main: draw("main", "body") });
    t.deepEqual((await Entities.getEntity(key, undefined, { layer: "main" }))!.layers, { main: draw("main", "body") });
});

test("each render mode maps to vanilla's blend, depth and colour state", t => {
    const created = Object.fromEntries(modes.map(mode => [mode, Materials.createEntityCanvasMaterial(canvas, mode)]));
    t.teardown(() => Object.values(created).forEach(material => { material.map!.dispose(); material.dispose(); }));
    const state = (mode: EntityRenderMode) => {
        const { transparent, alphaTest, depthWrite, colorWrite, polygonOffset, blending } = created[mode];
        return { transparent, alphaTest, depthWrite, colorWrite, polygonOffset, blending };
    };
    const cutout = { transparent: false, alphaTest: 0.5, depthWrite: true, colorWrite: true, polygonOffset: false, blending: NormalBlending };
    t.deepEqual(state("cutout"), cutout);
    t.deepEqual(state("cutout_cull"), cutout);
    t.deepEqual(state("cutout_z_offset"), { ...cutout, polygonOffset: true });
    t.true(created.cutout_z_offset.polygonOffsetFactor < 0 && created.cutout_z_offset.polygonOffsetUnits < 0);
    t.deepEqual(state("solid"), { ...cutout, alphaTest: 0 });
    t.deepEqual(state("translucent"), { ...cutout, transparent: true, alphaTest: 0.1 });
    t.deepEqual(state("breeze_wind"), { ...cutout, transparent: true, alphaTest: 0.1 });
    t.deepEqual(state("translucent_emissive"), { ...cutout, transparent: true, alphaTest: 0.1, depthWrite: false });
    t.deepEqual(state("eyes"), { ...cutout, transparent: true, alphaTest: 0, depthWrite: false });
    t.deepEqual(state("energy_swirl"), { ...cutout, transparent: true, alphaTest: 0.1, blending: CustomBlending });
    t.deepEqual(state("water_mask"), { ...cutout, alphaTest: 0, colorWrite: false });

    const swirl = created.energy_swirl;
    t.deepEqual([swirl.blendSrc, swirl.blendDst, swirl.blendSrcAlpha, swirl.blendDstAlpha], [OneFactor, OneFactor, ZeroFactor, OneFactor]);
    t.is(swirl.color.getHex(), 0x808080);
    t.is(created.translucent.color.getHex(), 0xffffff);
    for (const mode of modes) {
        const scrolls = mode === "energy_swirl" || mode === "breeze_wind";
        t.is(created[mode].map!.wrapS === RepeatWrapping && created[mode].map!.wrapT === RepeatWrapping, scrolls, mode);
        t.is(Materials.entityModeScroll(mode) !== undefined, scrolls, mode);
    }
    t.deepEqual(Materials.entityModeScroll("energy_swirl"), [0.01, 0.01]);
    t.deepEqual(Materials.entityModeScroll("breeze_wind"), [0.02, 0]);
});

test.serial("only modes that vanilla draws without culling get inward faces", async t => {
    const create = fixture(t);
    const object = await create(Object.fromEntries(modes.map(mode => [mode, { render: mode }])));
    const culled = modes.filter(mode => object.getMeshByName("root", mode)!.geometry.getIndex()!.count === 36);
    t.deepEqual(culled, ["cutout_cull", "solid", "eyes", "water_mask"]);
    for (const mode of modes.filter(mode => !culled.includes(mode))) {
        t.is(object.getMeshByName("root", mode)!.geometry.getIndex()!.count, 72, mode);
    }
    // A pass can override the mode of the geometry layer it draws.
    const layer = geometry("solid");
    const passes = await create({ own: { layer }, pass: { layer, render: "translucent" }, plain: {} });
    t.deepEqual(["own", "pass", "plain"].map(name => passes.getMeshByName("root", name)!.geometry.getIndex()!.count), [36, 72, 72]);
    t.deepEqual([material(passes, "own").alphaTest, material(passes, "pass").transparent], [0, true]);
});

test.serial("materials are shared per texture, mode and tint", async t => {
    const create = fixture(t);
    const texture = textureKey("entity/shared");
    const layers = {
        main: { texture },
        "main#2": { texture, render: "eyes" as const },
        wool: { texture, tint: "wool_color" },
        collar: { texture, tint: "collar_color" }
    };
    const first = await create(layers, { tints: { wool_color: "#ff0000" } });
    const second = await create(layers, { tints: { wool_color: 0x00ff00 } });
    t.is(material(first, "main"), material(second, "main"));
    t.is(material(first, "main#2"), material(second, "main#2"));
    t.not(material(first, "main"), material(first, "main#2"));
    t.is(material(first, "main#2").depthWrite, false);
    t.is(Caching.materialCache.getIfPresent(`entity:eyes::${texture.serialize()}`), material(first, "main#2"));
    // A label without a colour stays untinted and shares the plain material.
    t.is(material(first, "collar"), material(first, "main"));
    t.not(material(first, "wool"), material(second, "wool"));
    t.true(material(first, "wool").color.equals(new Color(0xff0000)));
    t.true(material(second, "wool").color.equals(new Color(0x00ff00)));
    t.is(material(first, "main").color.getHex(), 0xffffff);
    t.deepEqual([first, second].flatMap(object => ["main", "main#2", "wool"].map(name => (object.getLayerGroup(name)!.children[0].children[0] as Mesh).renderOrder)), [0, 1, 2, 0, 1, 2]);
});

test.serial("scrolling modes follow entity age on an owned texture and stop on disposal", async t => {
    const create = fixture(t);
    const texture = textureKey("entity/shared");
    const tickers = Ticker.tickers.size;
    const plain = await create({ main: { texture } });
    t.is(Ticker.tickers.size, tickers);

    const layers = { main: { texture }, armor: { texture, render: "energy_swirl" as const }, wind: { texture, render: "breeze_wind" as const } };
    const object = await create(layers);
    const other = await create(layers);
    const scene = Object.assign(new Object3D(), { isMineRenderScene: true, dirty: false });
    scene.add(object, other);
    t.is(Ticker.tickers.size, tickers + 2);
    t.is(material(object, "main"), material(plain, "main"));
    t.not(material(object, "armor"), material(other, "armor"));
    t.not(material(object, "armor").map, material(object, "main").map);
    t.is(Caching.materialCache.getIfPresent(`entity:energy_swirl::${texture.serialize()}`), undefined);
    t.is(Caching.materialCache.getIfPresent(`entity:cutout::${texture.serialize()}`), material(object, "main"));

    const tick = [...Ticker.tickers.values()][Ticker.tickers.size - 2];
    for (let i = 0; i < 3; i++) tick();
    t.is(object.age, 3);
    t.true(scene.dirty);
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    t.deepEqual(material(object, "armor").map!.offset.toArray().map(round), [0.03, -0.03]);
    t.deepEqual(material(object, "wind").map!.offset.toArray().map(round), [0.06, 0]);
    t.deepEqual(material(other, "armor").map!.offset.toArray(), [0, 0]);
    t.deepEqual(material(object, "main").map!.offset.toArray(), [0, 0]);
    object.age = 250;
    tick();
    t.deepEqual(material(object, "armor").map!.offset.toArray().map(round), [0.51, -0.51]);
    t.deepEqual(material(object, "wind").map!.offset.toArray().map(round), [0.02, 0]);

    // A disposal during texture loading must not leave a ticker behind.
    const late = await create(layers);
    late.dispose();
    await late["applyTextures"]();
    t.is(Ticker.tickers.size, tickers + 2);

    let disposed = 0;
    material(object, "armor").addEventListener("dispose", () => disposed++);
    material(object, "armor").map!.addEventListener("dispose", () => disposed++);
    material(object, "main").addEventListener("dispose", () => disposed += 10);
    object.dispose();
    other.dispose();
    t.is(disposed, 2);
    t.is(Ticker.tickers.size, tickers);
    t.is(Ticker["interval"], undefined);
});

test.serial("scrolling entity tickers pause while detached and resume once with the same age", async t => {
    const create = fixture(t);
    const tickers = Ticker.tickers.size;
    const object = await create({ armor: { render: "energy_swirl" }, wind: { render: "breeze_wind" } });
    const scene = Object.assign(new Object3D(), { isMineRenderScene: true, dirty: false });
    const tick = () => Ticker.tickers.forEach(callback => callback());
    t.is(Ticker.tickers.size, tickers);
    t.is(object.age, 0);

    scene.add(object);
    t.is(Ticker.tickers.size, tickers + 1);
    tick();
    t.is(object.age, 1);
    t.true(scene.dirty);
    const offset = material(object, "armor").map!.offset.clone();
    object.removeFromScene();
    scene.dirty = false;
    t.is(Ticker.tickers.size, tickers);
    tick();
    t.is(object.age, 1);
    t.true(material(object, "armor").map!.offset.equals(offset));
    t.false(scene.dirty);

    scene.add(object);
    scene.add(object);
    t.is(Ticker.tickers.size, tickers + 1);
    tick();
    t.is(object.age, 2);
    t.true(scene.dirty);
    object.dispose();
    t.is(Ticker.tickers.size, tickers);
    t.is(Ticker["interval"], undefined);
});
