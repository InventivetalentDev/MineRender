import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, Object3D, ShaderMaterial, Vector3 } from "three";
import { Armor, ArmorSet } from "../src/armor/Armor";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import { Env, EnvProvider } from "../src/Env";
import type { EntityModel, EntityModelFile, EntityModelLayer, EntityModelPart } from "../src/entity/EntityModel";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { MineRenderError } from "../src/error/MineRenderError";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import { Materials } from "../src/Materials";
import { SkinObject } from "../src/skin/scene/SkinObject";
import { SkinTextures } from "../src/skin/SkinTextures";
import { Ticker } from "../src/Ticker";
import { PalettedTextures } from "../src/texture/PalettedTextures";

const part = (offset: [number, number, number] = [0, 0, 0]): EntityModelPart => ({
    pose: { offset, rotation: [0, 0, 0] }, cubes: [{ origin: [-1, 0, -1], size: [2, 4, 2], uv: [0, 0] }], children: {}
});
const geometry = (children: Record<string, EntityModelPart>): EntityModelLayer => ({
    texture: [64, 32], root: { ...part(), cubes: [], children }
});
const texture = (path: string) => AssetKey.parse("textures", `minecraft:${path}`);
const image = (values = [255, 255, 255, 255]): ExtractableImageData => ({ width: values.length / 4, height: 1,
    data: { canvas: {}, getImageData: () => ({ data: new Uint8ClampedArray(values) }) }
} as unknown as ExtractableImageData);

function fixture(t: ExecutionContext) {
    const originals = { sources: [...AssetLoader["_SOURCES"]], get: ModelTextures.get, meta: ModelTextures.getMeta,
        image: Materials.getImage, skin: SkinTextures.get, provider: Env["_provider"] };
    const placeholder = new MeshBasicMaterial();
    const objects: (EntityObject | SkinObject)[] = [], requests: AssetKey[] = [], textures: AssetKey[] = [];
    const file: EntityModelFile = { id: "minecraft:player", layers: {
        helmet: geometry({ head: { ...part(), children: { hat: part([0, -1, 0]) } } }),
        chestplate: geometry({ body: part(), left_arm: part([5, 2, 0]), right_arm: part([-5, 2, 0]) }),
        leggings: geometry({ body: part(), left_leg: part([1.9, 12, 0]), right_leg: part([-1.9, 12, 0]) }),
        boots: geometry({ left_leg: part([1.9, 12, 0]), right_leg: part([-1.9, 12, 0]) })
    } };
    for (const layer of Object.values(file.layers)) {
        for (const name of ["head", "body", "left_arm", "right_arm", "left_leg", "right_leg"]) {
            layer.root.children[name] ??= { ...part(), cubes: [] };
        }
    }
    const assets: Record<string, unknown> = {};
    for (const name of ["iron", "diamond", "gold", "leather"]) assets[`equipment/minecraft:${name}`] = { layers: {
        humanoid: [{ texture: name }], humanoid_leggings: [{ texture: name }]
    } };
    assets["trim_pattern/minecraft:sentry"] = { asset_id: "custom:sentry", decal: true };
    assets["trim_material/minecraft:iron"] = { asset_name: "iron", override_armor_assets: { "minecraft:iron": "iron_darker" } };
    class Source extends AssetSource {
        async get(key: AssetKey) {
            requests.push(key);
            if (key.rootType === "entity-models") return file as any;
            if (key.namespace === "entity-models" && key.path === "version") return {} as any;
            return assets[`${key.assetType}/${key.namespace}:${key.path}`] as any;
        }
    }
    Caching.clear();
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("armor-test", new Source());
    const images = new Map<string, ExtractableImageData | undefined>();
    ModelTextures.get = async key => { textures.push(key); return images.has(key.getFullPath()) ? images.get(key.getFullPath()) : image(); };
    ModelTextures.getMeta = async () => undefined;
    Materials.getImage = () => placeholder;
    SkinTextures.get = async () => ({ material: placeholder, slim: false, legacy: false });
    Env.register({ name: "test", createCanvas: (width, height) => {
        let pixels = new Uint8ClampedArray(width * height * 4);
        const canvas = { width, height, getContext: () => context };
        const context = { canvas, createImageData: () => ({ width, height, data: new Uint8ClampedArray(pixels.length) }),
            putImageData: (value: { data: Uint8ClampedArray }) => { pixels = value.data; }, getImageData: () => ({ data: pixels }) };
        return canvas;
    } } as unknown as EnvProvider);
    t.teardown(() => {
        for (const object of objects) object.dispose();
        placeholder.dispose();
        AssetLoader["_SOURCES"] = originals.sources;
        ModelTextures.get = originals.get;
        ModelTextures.getMeta = originals.meta;
        Materials.getImage = originals.image;
        SkinTextures.get = originals.skin;
        Env["_provider"] = originals.provider;
        Caching.clear();
    });
    const entity = async (model: EntityModel, tints?: Record<string, number>) => {
        const object = new EntityObject(model, { tints });
        objects.push(object);
        for (const layer of Object.values(model.layers ?? { main: model })) {
            await Caching.textureAssetCache.get(layer.texture!.serialize(), async () => ({ key: layer.texture } as any));
        }
        await object.init();
        return object;
    };
    const skin = async (initialize = true) => {
        const object = new SkinObject();
        objects.push(object);
        await object.setSkinTexture("fixture");
        if (initialize) await object.init();
        return object;
    };
    return { file, assets, requests, textures, images, entity, skin };
}

test.serial("full armor sets preserve vanilla draw order, texture paths, names, and the skin frame", async t => {
    const f = fixture(t);
    const model = (await Armor.getEntity({ head: "diamond", chest: "leather", legs: "iron", feet: "gold" }))!;
    t.deepEqual(Object.keys(model.layers!), ["chestplate", "leggings", "boots", "helmet"]);
    t.deepEqual(Object.values(model.layers!).map(layer => layer.texture!.getFullPath()), [
        "entity/equipment/humanoid/leather", "entity/equipment/humanoid_leggings/iron",
        "entity/equipment/humanoid/gold", "entity/equipment/humanoid/diamond"
    ]);
    t.deepEqual(model.transform, [{ rotate: [0, Math.PI, 0] }, { scale: [-1, -1, 1] }, { translate: [0, -24, 0] }]);
    t.is(model.layer, f.file.layers.chestplate);
    const object = await f.entity(model);
    object.updateMatrixWorld(true);
    const point = object.getGroupByName("body", "chestplate")!.localToWorld(new Vector3(2, 3, 4));
    t.true(point.distanceTo(new Vector3(2, 21, -4)) < 1e-10);
    t.true(f.requests.filter(key => key.assetType === "equipment").every(key => key.rootType === "assets" && key.extension === ".json"));
    await Armor.getEntity({ head: "diamond" });
    t.is(f.requests.filter(key => key.assetType === "equipment" && key.path === "diamond").length, 1);
});

test.serial("leather dye, undyed integer and float colours, overlays, and first-drawn glint follow equipment layers", async t => {
    const f = fixture(t);
    f.assets["equipment/minecraft:leather"] = { layers: { humanoid: [
        { texture: "only_if_dyed", dyeable: {} }, { texture: "leather", dyeable: { color_when_undyed: 0xffa06540 } },
        { texture: "leather_overlay" }, { texture: "float_color", dyeable: { color_when_undyed: [1, 0.5, 0] } }
    ] } };
    for (const color of [undefined, 0, 0x3c44aa]) {
        const model = (await Armor.getEntity({ chest: { asset: "leather", color, glint: true } }))!;
        const draws = Object.values(model.layers!);
        t.deepEqual(draws.map(draw => draw.color), color ? [color, color, undefined, color] : [0xa06540, undefined, 0xff7f00]);
        t.deepEqual(draws.map(draw => draw.glint), draws.map((_, i) => i === 0 ? true : undefined));
        t.deepEqual(Object.keys(model.layers!), draws.map((_, i) => i ? `chestplate#${i + 1}` : "chestplate"));
    }
});

test.serial("empty or absent equipment layer types skip trims and return no model", async t => {
    const f = fixture(t);
    f.assets["equipment/minecraft:wings"] = { layers: { wings: [{ texture: "elytra" }], humanoid: [] } };
    for (const set of [{}, { head: "wings" }, { legs: { asset: "wings", trim: { pattern: "missing", material: "missing" } } }]) {
        t.is(await Armor.getEntity(set), undefined);
    }
    t.false(f.requests.some(key => key.rootType === "data"));
});

test.serial("missing equipment or geometry reports the Minecraft 1.21.4 floor", async t => {
    const f = fixture(t);
    await t.throwsAsync(Armor.getEntity({ head: "diamond_helmet" }), { instanceOf: MineRenderError,
        message: "Missing equipment asset diamond_helmet; armor takes equipment asset IDs such as minecraft:diamond and needs Minecraft 1.21.4 or later" });
    delete f.file.layers.helmet;
    await t.throwsAsync(Armor.getEntity({ head: "diamond" }), { instanceOf: MineRenderError, message: /helmet.*1\.21\.4/ });
});

test.serial("armor identifiers reject empty and relative path segments", async t => {
    fixture(t);
    for (const id of ["minecraft:../x", "minecraft:./x", "minecraft:x//y", "minecraft:/x", "minecraft:x/"]) {
        await t.throwsAsync(Armor.getEntity({ head: id }), { instanceOf: MineRenderError, message: `Invalid armor identifier ${id}` });
    }
});

test.serial("trims use registry asset IDs, equipment overrides, palette paths, and decal mode", async t => {
    const f = fixture(t);
    for (const asset of ["iron", "diamond"]) {
        const model = (await Armor.getEntity({ legs: { asset, trim: { pattern: "sentry", material: "iron" } } }))!;
        const trim = model.layers!["leggings#2"];
        t.is(trim.texture!.toNamespacedString(), "custom:trims/entity/humanoid_leggings/sentry");
        t.is(trim.palette!.key.toNamespacedString(), "minecraft:trims/color_palettes/trim_palette");
        t.is(trim.palette!.permutation.toNamespacedString(), `minecraft:trims/color_palettes/${asset === "iron" ? "iron_darker" : "iron"}`);
        t.is(trim.render, "cutout_z_offset");
        t.is(trim.glint, undefined);
    }
    t.true(f.requests.filter(key => key.assetType?.startsWith("trim_")).every(key => key.rootType === "data"));
    f.assets["trim_pattern/minecraft:plain"] = { asset_id: "sentry" };
    t.is((await Armor.getEntity({ head: { asset: "iron", trim: { pattern: "plain", material: "iron" } } }))!.layers!["helmet#2"].render, "cutout");
    await t.throwsAsync(Armor.getEntity({ head: { asset: "iron", trim: { pattern: "missing", material: "iron" } } }), { message: "Missing trim pattern missing" });
    await t.throwsAsync(Armor.getEntity({ head: { asset: "iron", trim: { pattern: "sentry", material: "missing" } } }), { message: "Missing trim material missing" });
});

test("palette permutation matches RGB, ignores transparent keys and pixels, multiplies alpha, and keeps unmapped pixels", t => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 128, 4, 5, 6, 255, 7, 8, 9, 0, 10, 11, 12, 200]);
    const key = new Uint8ClampedArray([1, 2, 3, 1, 4, 5, 6, 0, 7, 8, 9, 255]);
    const replacement = new Uint8ClampedArray([20, 30, 40, 128, 50, 60, 70, 255, 80, 90, 100, 255]);
    const result = PalettedTextures.permute(pixels, key, replacement);
    t.deepEqual(Array.from(result), [20, 30, 40, 64, 4, 5, 6, 255, 7, 8, 9, 0, 10, 11, 12, 200]);
    t.not(result, pixels);
    t.is(pixels[0], 1);
    t.throws(() => PalettedTextures.permute(pixels, key, new Uint8ClampedArray(4)), { instanceOf: MineRenderError });
});

test.serial("palette loads share a canvas and distinguish missing textures from missing palettes", async t => {
    const f = fixture(t), source = texture("trims/source"), key = texture("trims/key"), permutation = texture("trims/permutation");
    f.images.set(source.getFullPath(), image([1, 2, 3, 128]));
    f.images.set(key.getFullPath(), image([1, 2, 3, 255]));
    f.images.set(permutation.getFullPath(), image([20, 30, 40, 128]));
    const results = await Promise.all([PalettedTextures.get(source, key, permutation), PalettedTextures.get(source, key, permutation)]);
    t.is(results[0], results[1]);
    t.deepEqual(Array.from(results[0]!.data.getImageData(0, 0, 1, 1).data), [20, 30, 40, 64]);
    t.is(f.textures.length, 3);
    const missing = texture("trims/missing");
    f.images.set(missing.getFullPath(), undefined);
    t.is(await PalettedTextures.get(missing, key, permutation), undefined);
    await t.throwsAsync(PalettedTextures.get(source, missing, permutation), { instanceOf: MineRenderError, message: /Missing palette/ });
    await t.throwsAsync(PalettedTextures.get(source, key, missing), { instanceOf: MineRenderError, message: /Missing palette/ });
});

test.serial("entity colour defaults and tint labels share materials only with the same palette pair", async t => {
    const f = fixture(t), model = (await Armor.getEntity({ head: "iron" }))!;
    const base = model.layers!.helmet;
    base.color = 0x3c44aa;
    base.tint = "dye";
    const material = (object: EntityObject) => object.getMeshByName("head", "helmet")!.material as MeshBasicMaterial;
    t.is(material(await f.entity(model)).color.getHex(), 0x3c44aa);
    t.is(material(await f.entity(model, { dye: 0 })).color.getHex(), 0);
    base.palette = { key: texture("trims/key"), permutation: texture("trims/first") };
    const first = material(await f.entity(model));
    t.is(material(await f.entity(model)), first);
    base.palette = { ...base.palette, permutation: texture("trims/second") };
    const second = material(await f.entity(model));
    t.not(second, first);
    base.palette = { ...base.palette, key: texture("trims/other-key") };
    t.not(material(await f.entity(model)), second);
    t.true(f.textures.some(key => key.getFullPath() === "trims/other-key"));
});

test.serial("entity armor glint owns its meshes and ticker and releases its material on disposal", async t => {
    const f = fixture(t), model = (await Armor.getEntity({ head: { asset: "iron", glint: true } }))!;
    const object = await f.entity(model), passes: Mesh[] = [];
    object.traverse(child => { if (child.userData.minerenderItemGlint) passes.push(child as Mesh); });
    t.is(passes.length, 2);
    const material = passes[0].material as ShaderMaterial;
    t.is(material.defines.ENTITY_GLINT_SCALE, "0.16");
    t.true(passes.every(pass => pass.material === material && pass.geometry === (pass.parent as Mesh).geometry));
    t.true(f.textures.some(key => key.getFullPath() === "misc/enchanted_glint_armor"));
    const initialTickers = Ticker.tickers.size, parent = new Object3D();
    parent.add(object);
    t.is(Ticker.tickers.size, initialTickers + 1);
    object.removeFromParent();
    t.is(Ticker.tickers.size, initialTickers);
    parent.add(object);
    let disposed = 0;
    material.addEventListener("dispose", () => disposed++);
    object.dispose();
    t.is(disposed, 1);
    t.is(Ticker.tickers.size, initialTickers);
    t.deepEqual(object.children, []);
});

test.serial("a worn helmet creates only a head object, including when only its hat child has cubes", async t => {
    const f = fixture(t), skin = await f.skin();
    for (const onlyHat of [false, true]) {
        if (onlyHat) f.file.layers.helmet.root.children.head.cubes = [];
        await skin.setArmor({ head: "iron" });
        const armor: EntityObject[] = [];
        skin.traverse(object => { if (object instanceof EntityObject) armor.push(object); });
        t.is(armor.length, 1);
        t.is(armor[0].parent, skin.getGroupByName("head"));
        t.deepEqual(Object.keys(armor[0].entity.layers!), ["helmet"]);
    }
});

test.serial("worn armor attaches by part, follows poses, survives slim changes and reinitialization, and can be removed", async t => {
    const f = fixture(t), skin = await f.skin(false);
    const set: ArmorSet = { head: "diamond", chest: "leather", legs: "iron", feet: "gold" };
    await skin.setArmor(set);
    t.deepEqual(skin.children, []);
    await skin.init();
    const groups = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"].map(part => skin.getGroupByName(part)!);
    const armor = groups.map(group => group.children.find(child => child instanceof EntityObject) as EntityObject);
    t.is(armor.length, 6);
    t.true(armor.every(Boolean));
    t.deepEqual(groups.map(group => group.children.filter(child => child instanceof EntityObject).length), [1, 1, 1, 1, 1, 1]);
    const draws = armor.map(object => Object.keys(object.entity.layers!).length);
    t.deepEqual(draws, [1, 2, 1, 1, 2, 2]);
    t.is(draws.reduce((total, count) => total + count, 0), 9);
    t.deepEqual(armor.map(object => object.parent!.name), ["group:head", "group:body", "group:leftArm", "group:rightArm", "group:leftLeg", "group:rightLeg"]);
    const leftArm = skin.getGroupByName("leftArm")!, arm = armor[2];
    leftArm.rotation.x = -Math.PI / 2;
    skin.updateMatrixWorld(true);
    t.true(arm.localToWorld(new Vector3(0, 4, 0)).distanceTo(new Vector3(5, 22, 4)) < 1e-10);
    t.deepEqual(arm.entity.layer.root.children.left_arm.pose.offset, [0, 0, 0]);
    t.deepEqual(armor[0].entity.layer.root.children.head.children.hat.pose.offset, [0, -1, 0]);
    t.deepEqual(f.file.layers.chestplate.root.children.left_arm.pose.offset, [5, 2, 0]);
    skin.setSlim(true);
    t.is(arm.parent, leftArm);
    await skin.init();
    t.not(arm.parent, leftArm);
    t.is(arm.parent, skin.getGroupByName("leftArm"));
    await skin.setArmor(undefined);
    t.true(armor.every(object => object.parent === null && object.children.length === 0));
    await skin.setArmor({ head: "iron" });
    await skin.setArmor({});
    t.false(skin.getGroupByName("head")!.children.some(child => child instanceof EntityObject));
    await skin.setArmor({ head: "iron" });
    const last = skin.getGroupByName("head")!.children.find(child => child instanceof EntityObject)!;
    skin.dispose();
    t.is(last.parent, null);
    t.deepEqual(last.children, []);
});

test.serial("superseded armor calls dispose their staged objects and keep only the latest set", async t => {
    const f = fixture(t), skin = await f.skin();
    const original = EntityObject.prototype.init;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    const stale: EntityObject[] = [];
    EntityObject.prototype.init = async function () {
        await original.call(this);
        if (this.entity.texture!.path.endsWith("/iron")) { stale.push(this); started(); await waiting; }
    };
    t.teardown(() => { EntityObject.prototype.init = original; });
    const pending = skin.setArmor({ head: { asset: "iron", glint: true } });
    await entered;
    await skin.setArmor({ feet: "gold" });
    release();
    await pending;
    t.true(stale.every(object => object.parent === null && object.children.length === 0));
    const attached: EntityObject[] = [];
    skin.traverse(object => { if (object instanceof EntityObject) attached.push(object); });
    t.deepEqual(attached.map(object => object.parent!.name), ["group:leftLeg", "group:rightLeg"]);
    t.true(attached.every(object => object.entity.texture!.path.endsWith("/gold")));
});
