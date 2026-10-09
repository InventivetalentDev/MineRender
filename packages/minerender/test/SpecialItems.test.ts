import test, { ExecutionContext } from "ava";
import { Box3, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { BannerPatterns, DYE_COLORS } from "../src/assets/BannerPatterns";
import { DecoratedPots } from "../src/assets/DecoratedPots";
import { Entities, EntityModelOptions } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import type { EntityModel, EntityModelPart } from "../src/entity/EntityModel";
import type { EntityObject } from "../src/entity/scene/EntityObject";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { MinecraftAsset, TextureAsset } from "../src/MinecraftAsset";
import { Materials } from "../src/Materials";
import { DisplayPosition } from "../src/model/DisplayPosition";
import { GuiLight } from "../src/model/GuiLight";
import type { ItemModel, SpecialItemRenderer, TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { SpecialItems } from "../src/model/SpecialItems";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { UVMapper } from "../src/UVMapper";

const coordinates = (v: Vector3) => v.toArray().map(value => Math.round(value * 1e6) / 1e6 + 0);
const part = (children: Record<string, EntityModelPart> = {}, origin?: TripleArray, size: TripleArray = [8, 8, 8]): EntityModelPart => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
    cubes: origin ? [{ origin, size, uv: [0, 0] }] : [], children
});

function patterns(t: ExecutionContext, assets: Record<string, unknown>) {
    const original = [...AssetLoader["_SOURCES"]];
    const calls: AssetKey[] = [];
    class Source extends AssetSource {
        async get<T extends MinecraftAsset>(key: AssetKey): Promise<T | undefined> {
            calls.push(key);
            return assets[`${key.namespace}:${key.getFullPath()}`] as T | undefined;
        }
    }
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("test-patterns", new Source());
    t.teardown(() => { AssetLoader["_SOURCES"] = original; Caching.clear(); });
    return calls;
}

function fixture(t: ExecutionContext) {
    const originals = { entity: Entities.getEntity, texture: ModelTextures.get, preload: ModelTextures.preload, image: Materials.getImage, atlas: UVMapper.getAtlas };
    const material = new MeshBasicMaterial();
    const requests: { key: BasicAssetKey, texture?: BasicAssetKey, options?: EntityModelOptions }[] = [];
    const textures: AssetKey[] = [];
    const objects: ModelObject[] = [];
    const models: EntityModel[] = [];
    Caching.clear();
    Materials.getImage = () => material;
    UVMapper.getAtlas = async () => { throw new Error("Special items must not load a block-model atlas"); };
    ModelTextures.get = async key => {
        textures.push(key);
        return /^entity\/(?:banner|shield|decorated_pot)/.test(key.getFullPath())
            ? { width: 64, height: 64, data: { canvas: {} } } as unknown as ExtractableImageData : undefined;
    };
    ModelTextures.preload = async key => Caching.textureAssetCache.get(key.serialize(), async () => ({ key } as TextureAsset));
    Entities.getEntity = async (key, texture, options) => {
        requests.push({ key, texture, options });
        const id = key.path;
        const root = id === "chest" ? part({ bottom: part({}, [1, 0, 1], [14, 10, 14]), lid: part(), lock: part() })
            : id === "shulker_box" ? part({
                base: { ...part({}, [-8, -8, -8], [16, 8, 16]), pose: { offset: [0, 24, 0], rotation: [0, 0, 0] } },
                lid: { ...part({}, [-8, -16, -8], [16, 12, 16]), pose: { offset: [0, 24, 0], rotation: [0, 0, 0] } }
            })
            : id === "shield" ? part({ handle: part({}, [-1, -3, -1], [2, 6, 6]), plate: part({}, [-6, -11, -2], [12, 22, 1]) })
            : id === "standing_banner" ? part({ pole: part({}, [-1, -42, -1], [2, 42, 2]), bar: part({}, [-10, -44, -1], [20, 2, 2]) })
            : id === "trident" ? part({ pole: part({
                base: part({}, [-1.5, 0, -0.5], [3, 2, 1]),
                left_spike: part({}, [-2.5, -3, -0.5], [1, 4, 1]),
                middle_spike: part({}, [-0.5, -4, -0.5], [1, 4, 1]),
                right_spike: part({}, [1.5, -3, -0.5], [1, 4, 1])
            }, [-0.5, 2, -0.5], [1, 25, 1]) })
            : id === "conduit" ? part({ shell: part({}, [-3, -3, -3], [6, 6, 6]) })
            : id === "decorated_pot_base" ? part({
                bottom: { ...part({}, [0, 0, 0], [14, 0, 14]), pose: { offset: [1, 0, 1], rotation: [0, 0, 0] } },
                top: { ...part({}, [0, 0, 0], [14, 0, 14]), pose: { offset: [1, 16, 1], rotation: [0, 0, 0] } },
                neck: { ...part(), pose: { offset: [0, 37, 16], rotation: [Math.PI, 0, 0] }, cubes: [
                    { origin: [4, 17, 4], size: [8, 3, 8], grow: [-0.1, -0.1, -0.1], uv: [0, 0] },
                    { origin: [5, 20, 5], size: [6, 1, 6], grow: [0.2, 0.2, 0.2], uv: [0, 5] }
                ] }
            })
            : id === "decorated_pot_sides" ? part(Object.fromEntries(Object.entries({
                back: { offset: [15, 16, 1], rotation: [0, 0, Math.PI] },
                left: { offset: [1, 16, 1], rotation: [0, -Math.PI / 2, Math.PI] },
                right: { offset: [15, 16, 15], rotation: [0, Math.PI / 2, Math.PI] },
                front: { offset: [1, 16, 15], rotation: [Math.PI, 0, 0] }
            }).map(([name, pose]) => [name, { ...part({}, [0, 0, 0], [14, 16, 0]), pose,
                cubes: [{ origin: [0, 0, 0], size: [14, 16, 0], uv: [1, 0] }] } as EntityModelPart])))
            : id.startsWith("bed_") ? part({ main: part({}, [0, 0, 0], [16, 16, 6]) })
            : part({ head: part({ jaw: part(), left_ear: part(), right_ear: part() }, [-4, -8, -4]) });
        const model: EntityModel = { key, id, texture: texture as AssetKey | undefined, transform: [{ translate: [100, 200, 300] }], layer: { texture: [64, 64], root } };
        if (id.startsWith("decorated_pot_")) model.layer.texture = id.endsWith("base") ? [32, 32] : [16, 16];
        if (id === "trident" || id === "conduit") {
            model.layer.texture = id === "trident" ? [32, 32] : [32, 16];
            model.layers = { [options?.layer ?? "main"]: { key, texture: texture as AssetKey, layer: model.layer } };
        }
        if (id === "standing_banner") model.layers = {
            main: { key, texture: texture as AssetKey, layer: model.layer },
            flag: { key, texture: options?.textures?.flag as AssetKey, layer: { texture: [64, 64], root: part({
                flag: { ...part({}, [-10, 0, -2], [20, 40, 1]), pose: { offset: [0, -44, 0], rotation: [0, 0, 0] } }
            }) } }
        };
        models.push(model);
        return model;
    };
    t.teardown(() => {
        objects.forEach(object => object.dispose());
        Entities.getEntity = originals.entity;
        ModelTextures.get = originals.texture;
        ModelTextures.preload = originals.preload;
        Materials.getImage = originals.image;
        UVMapper.getAtlas = originals.atlas;
        material.dispose();
        Caching.clear();
    });
    const create = async (special: SpecialItemRenderer, display?: ItemModel["display"], components?: ItemModel["components"]) => {
        const model: ItemModel = {
            key: new AssetKey("custom", "fixture", "models", "item", "assets", ".json", "https://example.test/pack"), special, display, components
        };
        const object = await new MineRenderScene().addModel(model, { instanceMeshes: true, displayPosition: DisplayPosition.GUI });
        t.true(object instanceof ModelObject);
        objects.push(object as ModelObject);
        return object as ModelObject;
    };
    return { create, requests, textures, material, objects, models };
}

test.serial("special chest previews preserve texture origins, pose the lid, and own their cube geometry", async t => {
    const { create, requests, textures, material } = fixture(t);
    const object = await create({ type: "minecraft:chest", texture: "pack:polished", openness: 0.5 });
    t.false(object.isInstanced);
    t.is(requests[0].key.path, "chest");
    t.is((requests[0].key as AssetKey).root, "https://example.test/pack");
    t.is(textures[0].toNamespacedString(), "pack:entity/chest/polished");
    t.is(textures[0].root, "https://example.test/pack");
    t.is(object.getGroupByName("lid")!.rotation.x, -Math.PI / 4);
    t.is(object.getGroupByName("lock")!.rotation.x, -Math.PI / 4);
    object.updateMatrixWorld(true);
    const bottom = new Box3().setFromObject(object.getMeshByName("bottom")!);
    t.deepEqual([coordinates(bottom.min), coordinates(bottom.max)], [[-7, -8, -7], [7, 2, 7]]);
    const meshes: Mesh[] = [];
    object.iterateAllMeshes(mesh => meshes.push(mesh));
    let disposed = 0;
    let materialDisposed = 0;
    let ownedMaterialDisposed = 0;
    meshes.forEach(mesh => mesh.geometry.addEventListener("dispose", () => disposed++));
    material.addEventListener("dispose", () => materialDisposed++);
    const owned = meshes[0].material as MeshBasicMaterial;
    t.not(owned, material);
    owned.addEventListener("dispose", () => ownedMaterialDisposed++);
    object.dispose();
    t.is(disposed, meshes.length);
    t.is(materialDisposed, 0);
    t.is(ownedMaterialDisposed, 1);
});

test.serial("special beds join both halves before applying the inherited item display pose", async t => {
    const { create, requests, textures } = fixture(t);
    const object = await create({ type: "minecraft:bed", texture: "custom:blue" }, {
        [DisplayPosition.GUI]: { translation: [2, 3, 4], scale: [0.5, 0.5, 0.5] }
    });
    t.deepEqual(requests.map(request => request.key.path), ["bed_head", "bed_foot"]);
    t.deepEqual(textures.map(key => key.toNamespacedString()), ["custom:entity/bed/blue", "custom:entity/bed/blue"]);
    const bounds = new Box3().setFromObject(object);
    t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-2, 0.5, -8], [6, 3.5, 8]]);
});

test.serial("trident and conduit specials select their vanilla layers, solid materials, and transforms", async t => {
    const { create, requests, textures, models } = fixture(t);
    const trident = await create({ type: "minecraft:trident" });
    const conduit = await create({ type: "conduit" });
    t.deepEqual(requests.map(({ key, options }) => [key.path, options?.layer]), [["trident", "main"], ["conduit", "shell"]]);
    t.deepEqual(textures.map(key => key.toNamespacedString()), ["minecraft:entity/trident", "minecraft:entity/conduit/base"]);
    t.true(requests.every(request => (request.key as AssetKey).root === "https://example.test/pack"));
    t.true(textures.every(key => key.root === "https://example.test/pack"));
    const entities = [trident, conduit].map(object => object.children[0] as EntityObject);
    t.deepEqual(entities.map(entity => Object.keys(entity.entity.layers!)), [["main"], ["shell"]]);
    t.deepEqual(entities.map(entity => coordinates(new Vector3(1, 2, 3).applyMatrix4(entity.matrix))), [[-7, -10, -11], [1, 2, 3]]);
    const bounds = [trident, conduit].map(object => new Box3().setFromObject(object));
    t.deepEqual(bounds.map(box => [coordinates(box.min), coordinates(box.max)]), [
        [[-10.5, -35, -8.5], [-5.5, -4, -7.5]], [[-3, -3, -3], [3, 3, 3]]
    ]);
    for (const [index, object] of [trident, conduit].entries()) {
        t.false(object.isInstanced);
        t.is(entities[index].entity.render, "solid");
        t.true(Object.values(entities[index].entity.layers!).every(layer => layer.render === "solid"));
        object.iterateAllMeshes(mesh => t.is(mesh.geometry.getIndex()!.count, 36));
        t.is(models[index].render, undefined);
        t.true(Object.values(models[index].layers!).every(layer => layer.render === undefined));
    }
    const displayed = await create({ type: "minecraft:conduit" }, { gui: { translation: [2, 3, 4], scale: [0.5, 0.5, 0.5] } });
    const displayedBounds = new Box3().setFromObject(displayed);
    t.deepEqual([coordinates(displayedBounds.min), coordinates(displayedBounds.max)], [[0.5, 1.5, 2.5], [3.5, 4.5, 5.5]]);
});

test.serial("decorated pots map component order to outward side planes while retaining base textures and cached geometry", async t => {
    const { create, requests, models } = fixture(t);
    const decorations = ["archer_pottery_sherd", "prize_pottery_sherd", "arms_up_pottery_sherd", "skull_pottery_sherd"];
    const object = await create({ type: "minecraft:decorated_pot" }, undefined, { "minecraft:pot_decorations": decorations });
    const entity = object.children[0] as EntityObject;
    t.false(object.isInstanced);
    t.deepEqual(requests.map(request => [request.key.path, request.options?.layer]), [["decorated_pot_base", "main"], ["decorated_pot_sides", "main"]]);
    t.deepEqual(Object.keys(entity.entity.layers!), ["base", "front", "back", "left", "right"]);
    t.is(entity.entity.layers!.base.texture!.getFullPath(), "entity/decorated_pot/decorated_pot_base");
    const expected = {
        back: ["archer", [0, 0, -7], [0, 0, -1]], left: ["prize", [-7, 0, 0], [-1, 0, 0]],
        right: ["arms_up", [7, 0, 0], [1, 0, 0]], front: ["skull", [0, 0, 7], [0, 0, 1]]
    } as const;
    object.updateMatrixWorld(true);
    for (const side of ["back", "left", "right", "front"] as const) {
        const mesh = entity.getMeshByName(side, side)!;
        const [pattern, center, normal] = expected[side];
        t.is(entity.entity.layers![side].texture!.getFullPath(), `entity/decorated_pot/${pattern}_pottery_pattern`);
        t.is(mesh.geometry.getIndex()!.count, 6);
        t.deepEqual(coordinates(new Vector3(7, 8, 0).applyMatrix4(mesh.matrixWorld)), [...center]);
        t.deepEqual(coordinates(new Vector3(0, 0, -1).transformDirection(mesh.matrixWorld)), [...normal]);
        t.deepEqual(Array.from(mesh.geometry.getAttribute("uv").array).slice(40), [15 / 16, 0, 1 / 16, 0, 15 / 16, 1, 1 / 16, 1]);
        const material = mesh.material as MeshBasicMaterial;
        t.deepEqual([material.transparent, material.alphaTest, material.depthWrite], [false, 0, true]);
    }
    t.true(Object.values(entity.entity.layers!).every(layer => layer.texture?.root === "https://example.test/pack"));
    t.true(requests.every(request => (request.key as AssetKey).root === "https://example.test/pack"));
    const bounds = new Box3().setFromObject(object);
    t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-7, -8, -7], [7, 11.9, 7]]);
    t.true(Object.values(models[1].layer.root.children).every(child => !("faces" in child.cubes[0])));
    t.deepEqual(models[0].layer.root.children.neck.cubes[0].grow, [-0.1, -0.1, -0.1]);
    let geometriesDisposed = 0, materialsDisposed = 0, texturesDisposed = 0;
    const materials = new Set<MeshBasicMaterial>();
    object.iterateAllMeshes(mesh => { mesh.geometry.addEventListener("dispose", () => geometriesDisposed++); materials.add(mesh.material as MeshBasicMaterial); });
    materials.forEach(material => { material.addEventListener("dispose", () => materialsDisposed++); material.map!.addEventListener("dispose", () => texturesDisposed++); });
    object.dispose(); object.dispose();
    t.deepEqual([geometriesDisposed, materialsDisposed, texturesDisposed], [8, 5, 0]);
    t.deepEqual(decorations, ["archer_pottery_sherd", "prize_pottery_sherd", "arms_up_pottery_sherd", "skull_pottery_sherd"]);
});

test.serial("plain and partial pot decorations use fallback sides and reject malformed component lists", async t => {
    const { create, requests } = fixture(t);
    for (const value of [null, {}, [null], ["invalid:item:id"], new Array(5).fill("brick")]) {
        await t.throwsAsync(SpecialItems.getParts({ type: "decorated_pot" }, undefined, { "minecraft:pot_decorations": value }), { message: /[Pp]ot decoration|pot_decorations/ });
    }
    t.is(requests.length, 0);
    const plain = await create({ type: "decorated_pot" });
    const sides = (plain.children[0] as EntityObject).entity.layers!;
    t.true(["front", "back", "left", "right"].every(side => sides[side].texture!.path === "decorated_pot/decorated_pot_side"));
    const partial = DecoratedPots.getSideTextures(["flow_pottery_sherd", "minecraft:brick", "minecraft:diamond"]);
    t.deepEqual(Object.values(partial).map(key => key.path), ["decorated_pot/flow_pottery_pattern", ...new Array(3).fill("decorated_pot/decorated_pot_side")]);
    t.is(DecoratedPots.getSideTextures(["pack:archer_pottery_sherd"]).back.path, "decorated_pot/decorated_pot_side");
    const preload = ModelTextures.preload;
    ModelTextures.preload = async key => key.path === "decorated_pot/archer_pottery_pattern" ? undefined : preload(key);
    await t.throwsAsync(SpecialItems.getParts({ type: "decorated_pot" }, undefined, { "minecraft:pot_decorations": ["archer_pottery_sherd"] }),
        { message: /Missing special item texture minecraft:entity\/decorated_pot\/archer_pottery_pattern/ });
});

test.serial("banner patterns use registry asset IDs, namespaces, directory indexes, and the first 16 ordered layers", async t => {
    fixture(t);
    const assets: Record<string, unknown> = {
        "pack:_list": { files: ["cross.json", "_list.json", "notes.txt"], directories: ["nested"] },
        "pack:nested/_list": { files: ["stripe.json"], directories: [] },
        "pack:cross": { asset_id: "texturepack:nested/custom", translation_key: "pattern.custom" }
    };
    const calls = patterns(t, assets);
    const root = "https://example.test/pattern-pack";
    t.deepEqual(await BannerPatterns.getList("pack", root), ["pack:cross", "pack:nested/stripe"]);
    const supplied = [
        { pattern: "pack:cross", color: "red" },
        { pattern: { asset_id: "dots.json", translation_key: "pattern.dots" }, color: "white" }
    ];
    const before = JSON.stringify(supplied);
    const draws = await BannerPatterns.getLayers(supplied, "banner", root);
    t.deepEqual(draws.map(draw => [draw.texture.toNamespacedString(), draw.color]), [
        ["texturepack:entity/banner/nested/custom", 0xb02e26], ["minecraft:entity/banner/dots.json", 0xf9fffe]
    ]);
    t.true(draws.every(draw => draw.texture.root === root && draw.texture.extension === ".png"));
    t.true(calls.every(key => key.root === root && key.rootType === "data" && key.assetType === "banner_pattern"));
    t.is(JSON.stringify(supplied), before);
    const capped = await BannerPatterns.getLayers([...Array.from({ length: 16 }, () => supplied[0]), { pattern: "missing", color: "invalid" }], "shield", root);
    t.is(capped.length, 16);
    t.true(capped.every(draw => draw.texture.toNamespacedString() === "texturepack:entity/shield/nested/custom"));
    t.is(calls.filter(key => key.path === "cross").length, 1);
    await BannerPatterns.getLayers([supplied[0]], "banner", `${root}/another-version`);
    t.is(calls.filter(key => key.path === "cross").length, 2);
    await t.throwsAsync(BannerPatterns.getLayers([{ pattern: "pack:new", color: "blue" }], "banner"), { message: /Missing banner pattern pack:new/ });
    assets["pack:new"] = { asset_id: "new_mask", translation_key: "pattern.new" };
    t.is((await BannerPatterns.getLayers([{ pattern: "pack:new", color: "blue" }], "banner"))[0].texture.path, "banner/new_mask");
});

test.serial("banner passes keep the pole untinted and apply one fixed flag pose without changing cached geometry", async t => {
    const { create, requests, models } = fixture(t);
    const object = await create({ type: "banner", color: "red" }, undefined, {
        "minecraft:base_color": "blue",
        "minecraft:banner_patterns": [{ pattern: { asset_id: "stripe_bottom", translation_key: "pattern.stripe" }, color: "white" }]
    });
    const entity = object.children[0] as EntityObject;
    t.deepEqual(requests[0].options?.layers, ["main", "flag"]);
    t.deepEqual(Object.keys(entity.entity.layers!), ["main", "flag", "pattern_base", "pattern_0"]);
    t.is(entity.entity.render, "solid");
    const pole = entity.getMeshByName("pole", "main")!;
    t.is((pole.material as MeshBasicMaterial).color.getHex(), 0xffffff);
    t.is(pole.geometry.getIndex()!.count, 36);
    t.deepEqual(coordinates(new Vector3(0, 0, 0).applyMatrix4(entity.matrix)), [0, -8, 0]);
    for (const [index, name] of ["flag", "pattern_base", "pattern_0"].entries()) {
        const mesh = entity.getMeshByName("flag", name)!;
        t.is(entity.getGroupByName("flag", name)!.rotation.x, -0.0025 * Math.PI);
        t.is(mesh.renderOrder, index + 1);
        if (name !== "flag") {
            const material = mesh.material as MeshBasicMaterial;
            t.deepEqual([material.transparent, material.alphaTest, material.depthWrite], [true, 0, false]);
            t.is(material.color.getHex(), name === "pattern_base" ? 0xb02e26 : 0xf9fffe);
            t.is(mesh.geometry.getIndex()!.count, 72);
            t.is(entity.getMeshByName("pole", name), undefined);
        }
    }
    t.is(models[0].layers!.flag.layer.root.children.flag.pose.rotation[0], 0);
    t.deepEqual(Object.keys(models[0].layers!), ["main", "flag"]);
    t.true(Object.values(entity.entity.layers!).every(layer => layer.texture?.root === "https://example.test/pack"));
});

test.serial("shield decoration switches the base texture and draws masks only on the plate", async t => {
    const { create, requests } = fixture(t);
    const plain = await create({ type: "minecraft:shield" });
    const dyed = await create({ type: "shield" }, undefined, { "minecraft:base_color": "blue" });
    const decorated = await create({ type: "shield" }, undefined, {
        "minecraft:banner_patterns": [{ pattern: { asset_id: "cross", translation_key: "pattern.cross" }, color: "black" }]
    });
    t.deepEqual(requests.map(request => request.texture!.toNamespacedString()), [
        "minecraft:entity/shield_base_nopattern", "minecraft:entity/shield_base", "minecraft:entity/shield_base"
    ]);
    const entities = [plain, dyed, decorated].map(object => object.children[0] as EntityObject);
    t.deepEqual(entities.map(entity => Object.keys(entity.entity.layers!)), [["main"], ["main", "pattern_base"], ["main", "pattern_base", "pattern_0"]]);
    t.deepEqual(entities.map(entity => (entity.getMeshByName("handle", "main")!.material as MeshBasicMaterial).color.getHex()), [0xffffff, 0xffffff, 0xffffff]);
    t.deepEqual(entities.slice(1).map(entity => (entity.getMeshByName("plate", "pattern_base")!.material as MeshBasicMaterial).color.getHex()), [0x3c44aa, 0xf9fffe]);
    t.is((entities[2].getMeshByName("plate", "pattern_0")!.material as MeshBasicMaterial).color.getHex(), 0x1d1d21);
    t.is(entities[2].getMeshByName("handle", "pattern_0"), undefined);
    plain.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(plain.getMeshByName("plate")!);
    t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-14, -19, -7], [-2, 3, -6]]);
    t.is(Object.keys(DYE_COLORS).length, 16);
});

test.serial("composite shield components keep independent colors and dispose owned resources once", async t => {
    const { objects } = fixture(t);
    const first: ItemModel = { key: AssetKey.parse("models", "test:item/shield"), special: { type: "shield" }, gui_light: GuiLight.FRONT,
        components: { "minecraft:base_color": "red" }, display: { gui: { scale: [0.5, 0.5, 0.5] } } };
    const second: ItemModel = { ...first, gui_light: GuiLight.SIDE, components: { "minecraft:base_color": "blue" } };
    const model: ItemModel = { key: AssetKey.parse("models", "test:item/composite"), parts: [first, second] };
    const before = JSON.stringify(model);
    const object = await new MineRenderScene().addModel(model, { instanceMeshes: true, displayPosition: DisplayPosition.GUI }) as ModelObject;
    objects.push(object);
    const entities = object.children.map(child => child.children[0] as EntityObject);
    const palettes = entities.map(entity => entity.getMeshByName("plate", "pattern_base")!.material as MeshBasicMaterial);
    t.deepEqual(palettes.map(material => material.color.getHex()), [0xb02e26, 0x3c44aa]);
    t.not(palettes[0].customProgramCacheKey(), "special-item-side");
    t.is(palettes[1].customProgramCacheKey(), "special-item-side");
    const meshes: Mesh[] = [];
    object.iterateAllMeshes(mesh => meshes.push(mesh));
    t.deepEqual(meshes.map(mesh => mesh.renderOrder), [0, 1, 2, 3, 4, 5]);
    t.true(meshes.every(mesh => (mesh.material as MeshBasicMaterial).transparent));
    t.true(entities.every(entity => !(entity.getMeshByName("plate", "pattern_base")!.material as MeshBasicMaterial).depthWrite));
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
    meshes.forEach(mesh => mesh.geometry.addEventListener("dispose", () => geometryDisposals++));
    const materials = new Set(meshes.map(mesh => mesh.material as MeshBasicMaterial));
    materials.forEach(material => material.addEventListener("dispose", () => materialDisposals++));
    new Set([...materials].map(material => material.map!)).forEach(texture => texture.addEventListener("dispose", () => textureDisposals++));
    object.dispose(); object.dispose();
    t.deepEqual([geometryDisposals, materialDisposals, textureDisposals], [6, 4, 0]);
    t.is(JSON.stringify(model), before);
});

test.serial("invalid pattern components and missing textures fail before creating special-item meshes", async t => {
    const { requests } = fixture(t);
    for (const value of [null, {}, [null], [{ pattern: "cross", color: "invalid" }], [{ pattern: { asset_id: "cross" }, color: "white" }]]) {
        await t.throwsAsync(SpecialItems.getParts({ type: "shield" }, undefined, { "minecraft:banner_patterns": value }));
    }
    await t.throwsAsync(SpecialItems.getParts({ type: "shield" }, undefined, { "minecraft:base_color": "toString" }), { message: /Unsupported dye color/ });
    t.is(requests.length, 0);
    ModelTextures.preload = async () => undefined;
    await t.throwsAsync(SpecialItems.getParts({ type: "shield" }), { message: /Missing special item texture minecraft:entity\/shield_base_nopattern/ });
});

test.serial("special shulker boxes use vanilla lid poses without changing cached entity data", async t => {
    const { create, requests, textures, models } = fixture(t);
    for (const [openness, height] of [[undefined, 7.996], [0.5, 11.994], [1, 15.992], [2, 23.988]] as const) {
        const object = await create({ type: "minecraft:shulker_box", texture: "pack:shulker_red", openness });
        t.false(object.isInstanced);
        const lid = object.getGroupByName("lid")!;
        t.deepEqual(lid.position.toArray(), [0, 24 - (openness ?? 0) * 8, 0]);
        t.is(lid.rotation.y, (openness ?? 0) * Math.PI * 1.5);
        const bounds = new Box3().setFromObject(object);
        t.is(coordinates(bounds.min)[1], -7.996);
        t.is(coordinates(bounds.max)[1], height);
        if (openness === undefined) t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-7.996, -7.996, -7.996], [7.996, 7.996, 7.996]]);
    }
    t.true(requests.every(request => request.key.path === "shulker_box" && (request.key as AssetKey).root === "https://example.test/pack"));
    t.true(textures.every(key => key.toNamespacedString() === "pack:entity/shulker/shulker_red" && key.root === "https://example.test/pack"));
    for (const model of models) {
        t.deepEqual(model.layer.root.children.lid.pose, { offset: [0, 24, 0], rotation: [0, 0, 0] });
        t.deepEqual(Object.keys(model.layer.root.children), ["base", "lid"]);
    }
});

test.serial("shulker orientations preserve vanilla opening directions and texture orientation", async t => {
    const { create } = fixture(t);
    const orientations = {
        up: [[0, 1, 0], [1, 0, 0]], down: [[0, -1, 0], [1, 0, 0]],
        north: [[0, 0, -1], [-1, 0, 0]], south: [[0, 0, 1], [1, 0, 0]],
        west: [[-1, 0, 0], [0, 0, 1]], east: [[1, 0, 0], [0, 0, -1]]
    } as const;
    for (const orientation of Object.keys(orientations) as Array<keyof typeof orientations>) {
        const object = await create({ type: "shulker_box", texture: "shulker", openness: 1, orientation });
        object.updateMatrixWorld(true);
        const lidTop = object.getGroupByName("lid")!.localToWorld(new Vector3(0, -16, 0));
        const baseRight = object.getGroupByName("base")!.localToWorld(new Vector3(1, -8, 0));
        const [normal, right] = orientations[orientation];
        t.deepEqual(coordinates(lidTop), coordinates(new Vector3(...normal).multiplyScalar(15.992)));
        t.deepEqual(coordinates(baseRight), coordinates(new Vector3(...right).multiplyScalar(0.9995)));
    }
});

test.serial("composite shulker items retain independent display poses, lighting, and owned resource disposal", async t => {
    const { objects, material } = fixture(t);
    const closed: ItemModel = { key: AssetKey.parse("models", "test:item/shulker"), gui_light: GuiLight.FRONT,
        special: { type: "shulker_box", texture: "shulker" }, display: { gui: { translation: [2, 3, 4], scale: [0.5, 0.5, 0.5] } } };
    const open: ItemModel = { ...closed, gui_light: GuiLight.SIDE,
        special: { type: "shulker_box", texture: "shulker", openness: 1, orientation: "east" } };
    const model: ItemModel = { key: AssetKey.parse("models", "test:item/composite"), parts: [closed, open] };
    const original = JSON.stringify(model);
    const composite = await new MineRenderScene().addModel(model, { instanceMeshes: true, displayPosition: DisplayPosition.GUI }) as ModelObject;
    objects.push(composite);
    t.false(composite.isInstanced);
    const [first, second] = composite.children as ModelObject[];
    t.deepEqual([first.getGroupByName("lid")!.position.y, second.getGroupByName("lid")!.position.y], [24, 16]);
    const bounds = new Box3().setFromObject(first);
    t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-1.998, -0.998, 0.002], [5.998, 6.998, 7.998]]);
    const firstMaterial = first.getMeshByName("base")!.material as MeshBasicMaterial;
    const secondMaterial = second.getMeshByName("base")!.material as MeshBasicMaterial;
    t.not(firstMaterial.customProgramCacheKey(), "special-item-side");
    t.is(secondMaterial.customProgramCacheKey(), "special-item-side");
    let geometryDisposals = 0, ownedDisposals = 0, sharedDisposals = 0;
    composite.iterateAllMeshes(mesh => mesh.geometry.addEventListener("dispose", () => geometryDisposals++));
    firstMaterial.addEventListener("dispose", () => ownedDisposals++);
    secondMaterial.addEventListener("dispose", () => ownedDisposals++);
    material.addEventListener("dispose", () => sharedDisposals++);
    composite.dispose(); composite.dispose();
    t.deepEqual([geometryDisposals, ownedDisposals, sharedDisposals], [4, 2, 0]);
    t.is(JSON.stringify(model), original);
});

test.serial("invalid shulker options reject before loading entity geometry", async t => {
    const { requests } = fixture(t);
    for (const options of [{ orientation: "sideways" }, { orientation: null }, { openness: NaN }, { openness: "1" }, { texture: "" }]) {
        await t.throwsAsync(SpecialItems.getParts({ type: "shulker_box", texture: "shulker", ...options } as unknown as SpecialItemRenderer), { message: /[Ss]hulker-box/ });
    }
    t.is(requests.length, 0);
});

test.serial("special heads face forward and apply vanilla's static dragon and piglin animation poses", async t => {
    const { create, requests, textures } = fixture(t);
    const creeper = await create({ type: "minecraft:head", kind: "creeper", texture: "custom:heads/green" });
    t.is(requests[0].key.path, "creeper_head");
    t.is(textures[0].toNamespacedString(), "custom:entity/heads/green");
    creeper.updateMatrixWorld(true);
    t.deepEqual(coordinates(new Vector3(0, -4, -4).applyMatrix4(creeper.getMeshByName("head")!.matrixWorld)), [0, -4, 4]);
    const dragon = await create({ type: "minecraft:head", kind: "dragon" });
    t.is(requests[1].key.path, "dragon_skull");
    t.is(dragon.getGroupByName("jaw")!.rotation.x, 0.2);
    const animated = await create({ type: "minecraft:head", kind: "dragon", animation: 2.5 });
    t.is(animated.getGroupByName("jaw")!.rotation.x, 0.4);
    const piglin = await create({ type: "minecraft:head", kind: "piglin" });
    t.is(requests[3].key.path, "piglin_head");
    t.true(Math.abs(piglin.getGroupByName("left_ear")!.rotation.z + 0.7) < 1e-6);
    t.true(Math.abs(piglin.getGroupByName("right_ear")!.rotation.z - 0.7) < 1e-6);
});
