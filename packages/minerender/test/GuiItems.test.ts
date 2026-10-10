import test, { ExecutionContext } from "ava";
import { Box3, ClampToEdgeWrapping, Color, CustomBlending, EqualDepth, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, NearestFilter, OneFactor, Raycaster, RepeatWrapping, ShaderMaterial, SrcColorFactor, Vector3, ZeroFactor } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Entities } from "../src/assets/Entities";
import { Models } from "../src/assets/Models";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { GuiObject } from "../src/gui/scene/GuiObject";
import { Materials } from "../src/Materials";
import { GuiLight } from "../src/model/GuiLight";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { Ticker } from "../src/Ticker";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { ItemModel, TextureAsset } from "../src/model/Model";
import { Fonts, type BitmapGlyph } from "../src/assets/Fonts";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import { ModelObject } from "../src/model/scene/ModelObject";
import type { InstanceReference } from "../src/instance/InstanceReference";
import { ItemGlint } from "../src/model/ItemGlint";
import { DisplayPosition } from "../src/model/DisplayPosition";
import { Axis } from "../src/Axis";

function fixture(t: ExecutionContext) {
    const originals = { merged: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage,
        texture: ModelTextures.get, meta: ModelTextures.getMeta, shaded: Materials.createShadedCanvasMaterial };
    const scene = new MineRenderScene(), placeholder = new MeshBasicMaterial();
    const requests: AssetKey[] = [];
    let imageDisposals = 0;
    const image = { width: 16, height: 16, canvas: { width: 16, height: 16 },
        dispose: () => imageDisposals++ } as unknown as CanvasImage;
    const model: ItemModel = {
        key: AssetKey.parse("models", "test:item/front"), gui_light: GuiLight.FRONT,
        display: { gui: { translation: [12, 3, 5], rotation: [0, 0, 90], scale: [0.5, 1, 0.25] } },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", tintindex: 0 }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0]) }]
    };
    const side = { ...model, gui_light: GuiLight.SIDE };
    const atlas = new TextureAtlas(model, image, { side: [16, 16] }, { side: [0, 0] }, true, { side: () => true }, false);
    const sideAtlas = new TextureAtlas(side, image, atlas.sizes, atlas.positions, false, {}, false);
    Caching.clear();
    ModelTextures.getMeta = async () => undefined;
    Models.getMerged = async key => { requests.push(key); return key.path === "missing" ? undefined : key.path === "side" ? side : model; };
    UVMapper.getAtlas = async value => value === side ? sideAtlas : atlas;
    Materials.getImage = () => placeholder;
    ModelTextures.get = async key => {
        Caching.textureAssetCache.get(key.serialize(), async () => ({ key } as TextureAsset));
        return { width: 16, height: 16, data: { canvas: image.canvas } } as unknown as ExtractableImageData;
    };
    t.teardown(() => {
        for (const object of [...scene.children]) { (object as GuiObject).dispose(); object.removeFromParent(); }
        Models.getMerged = originals.merged; UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.image; ModelTextures.get = originals.texture;
        ModelTextures.getMeta = originals.meta;
        Materials.createShadedCanvasMaterial = originals.shaded;
        atlas.dispose(); sideAtlas.dispose(); placeholder.dispose(); Caching.clear();
    });
    return { scene, model, atlas, requests, imageDisposals: () => imageDisposals };
}

function countFont(t: ExecutionContext) {
    const original = Fonts.get;
    const image = { width: 64, height: 16 } as CompatCanvas;
    const glyphs = new Map<string, BitmapGlyph>([..."0123456789"].map((character, index) => [character,
        { image, x: index * 6, y: 0, width: 5, height: 8, scale: 1, ascent: 7, advance: 6.25 }]));
    const requests: unknown[] = [];
    Fonts.get = async key => { requests.push(key); return { glyphs }; };
    t.teardown(() => { Fonts.get = original; });
    return { image, requests };
}

test.serial("item glint separates instances and owns its animated pass while sharing cached textures and base geometry", async t => {
    const { scene, model, atlas } = fixture(t);
    model.key!.root = "glint-pack";
    const textureKeys: AssetKey[] = [];
    const getTexture = ModelTextures.get;
    ModelTextures.get = async key => { textureKeys.push(key); return getTexture(key); };
    ModelTextures.getMeta = async () => ({ texture: { blur: true } });
    const originalNow = Date.now;
    let now = 100;
    Date.now = () => now;
    t.teardown(() => { Date.now = originalNow; });
    const plain = await scene.addModel(model) as InstanceReference<ModelObject>;
    const before = new Set(Ticker.tickers.keys());
    const glintModel = { ...model, key: new AssetKey("test", "front", "models", "item", "assets", ".json", "glint-pack"),
        components: { "minecraft:enchantments": { "minecraft:sharpness": 1 } } };
    const object = await scene.addModel(glintModel) as ModelObject;
    const second = await scene.addModel({ ...model, components: { enchantments: { sharpness: 1 }, enchantment_glint_override: false } }) as InstanceReference<ModelObject>;
    t.is(second.instanceable, plain.instanceable);
    t.true(object.isModelObject);
    t.false(object.isInstanced);
    const meshes: Mesh[] = [];
    object.iterateAllMeshes(mesh => meshes.push(mesh));
    t.is(meshes.length, 2);
    const [base, pass] = meshes, material = pass.material as ShaderMaterial;
    t.is(pass.geometry, base.geometry);
    t.is(pass.parent, base);
    t.true(base.renderOrder < pass.renderOrder);
    t.deepEqual([material.blending, material.blendSrc, material.blendDst, material.blendSrcAlpha, material.blendDstAlpha],
        [CustomBlending, SrcColorFactor, OneFactor, ZeroFactor, OneFactor]);
    t.is(material.depthFunc, EqualDepth);
    t.false(material.depthWrite);
    t.true(material.forceSinglePass);
    t.is(material.uniforms.baseMap.value, (base.material as ShaderMaterial).uniforms.map.value);
    const texture = material.uniforms.glintMap.value;
    t.deepEqual([texture.wrapS, texture.wrapT, texture.minFilter, texture.magFilter], [RepeatWrapping, RepeatWrapping, LinearFilter, LinearFilter]);
    t.deepEqual(textureKeys.map(key => [key.toNamespacedString(), key.root]), [["minecraft:misc/enchanted_glint_item", "glint-pack"]]);
    const ticker = [...Ticker.tickers.keys()].find(key => !before.has(key))!;
    const offset = material.uniforms.glintOffset.value.clone();
    now += 50;
    scene.dirty = false;
    Ticker.tickers.get(ticker)!();
    t.true(scene.dirty);
    t.notDeepEqual(material.uniforms.glintOffset.value, offset);
    object.removeFromParent();
    t.false(Ticker.tickers.has(ticker));
    scene.add(object);
    t.is(Ticker.tickers.size, before.size + 1);
    const shared = await scene.addModel(glintModel) as ModelObject;
    const sharedMaterial = (shared.getObjectByName(pass.name) as Mesh).material as ShaderMaterial;
    t.not(sharedMaterial, material);
    t.is(sharedMaterial.uniforms.glintMap.value, texture);
    t.is(textureKeys.length, 1);
    shared.dispose();
    let geometries = 0, materials = 0, textures = 0, atlasImages = 0;
    base.geometry.addEventListener("dispose", () => geometries++);
    material.addEventListener("dispose", () => materials++);
    texture.addEventListener("dispose", () => textures++);
    const dispose = atlas.image.dispose;
    atlas.image.dispose = () => { atlasImages++; };
    object.dispose(); object.dispose();
    atlas.image.dispose = dispose;
    t.deepEqual([geometries, materials, textures, atlasImages], [1, 1, 0, 0]);
    t.is(Ticker.tickers.size, before.size);
    ModelTextures.getMeta = async () => ({ texture: { clamp: true } });
    const clamped = await scene.addModel({ ...glintModel,
        key: new AssetKey("test", "front", "models", "item", "assets", ".json", "clamped-glint-pack") }) as ModelObject;
    let clampedMaterial: ShaderMaterial | undefined;
    clamped.iterateAllMeshes(mesh => { if (mesh.userData.minerenderItemGlint) clampedMaterial = mesh.material as ShaderMaterial; });
    const clampedTexture = clampedMaterial!.uniforms.glintMap.value;
    t.not(clampedTexture, texture);
    t.deepEqual(textureKeys.map(key => key.root), ["glint-pack", "clamped-glint-pack"]);
    t.deepEqual([clampedTexture.wrapS, clampedTexture.wrapT, clampedTexture.minFilter, clampedTexture.magFilter],
        [ClampToEdgeWrapping, ClampToEdgeWrapping, NearestFilter, NearestFilter]);
    clamped.dispose();
    Caching.clear();
    let metadataLoads = 0;
    ModelTextures.getMeta = async () => {
        if (++metadataLoads === 1) { Caching.clear(); return { texture: { clamp: true } }; }
        return { texture: { blur: true } };
    };
    const refreshed = await scene.addModel(glintModel) as ModelObject;
    const refreshedTexture = ((refreshed.getObjectByName(pass.name) as Mesh).material as ShaderMaterial).uniforms.glintMap.value;
    t.is(metadataLoads, 2);
    t.not(refreshedTexture, texture);
    t.deepEqual([refreshedTexture.wrapS, refreshedTexture.magFilter], [RepeatWrapping, LinearFilter]);
    refreshed.dispose();
});

test.serial("GUI glint keeps its pass name and draw order without intercepting item picking", async t => {
    const { scene, model } = fixture(t);
    model.components = { enchantment_glint_override: true };
    const gui = await scene.addGui([
        { name: "background", texture: "test:gui/background" },
        { name: "item", item: "test:item/front", context: { components: { damage: 50, max_damage: 100 } } },
        { name: "cover", texture: "test:gui/overlay" }
    ]);
    const item = gui.getGroupByName("item")!;
    const base = gui.getMeshByName("item")!, pass = base.children[0] as Mesh;
    t.true(pass.userData.minerenderItemGlint);
    t.true(pass.name.endsWith(":glint"));
    const ordered = [gui.getMeshByName("background")!, base, pass, gui.getMeshByName("item:durability-background")!, gui.getMeshByName("cover")!];
    t.true(ordered.every((mesh, index) => index === 0 || mesh.renderOrder > ordered[index - 1].renderOrder));
    gui.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(item), origin = bounds.getCenter(new Vector3());
    origin.z = bounds.max.z + 1;
    const hits = new Raycaster(origin, new Vector3(0, 0, -1)).intersectObject(item, true);
    t.true(hits.length > 0);
    t.true(hits.every(hit => hit.object === base));
});

test.serial("glint UV density ignores atlas packing and texture resolution while retaining cropped face orientation", t => {
    const { model, atlas } = fixture(t);
    const shared = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    const geometry = shared.clone();
    const uv = geometry.getAttribute("uv");
    const corners = [[0.25, 0.75], [0.25, 0.25], [0.75, 0.75], [0.75, 0.25]];
    corners.forEach(([u, v], index) => uv.setXY(index, u, 1 - v));
    ItemGlint.mapUvs(geometry, model.elements![0].faces, atlas);
    const expected = corners.flatMap(([u, v]) => [u / 32, v / 32]);
    t.deepEqual(Array.from(geometry.getAttribute("glintUv").array).slice(0, 8), expected);
    const packed = new TextureAtlas(model, { width: 128, height: 128 } as CanvasImage, { side: [64, 32] }, { side: [32, 16] }, false, {}, false);
    corners.forEach(([u, v], index) => uv.setXY(index, (32 + u * 64) / 128, 1 - (16 + v * 32) / 128));
    ItemGlint.mapUvs(geometry, model.elements![0].faces, packed);
    t.deepEqual(Array.from(geometry.getAttribute("glintUv").array).slice(0, 8), expected);
    t.false(shared.hasAttribute("glintUv"));
    geometry.dispose();
});

test.serial("compass and clock glint projects all face directions with display-context scale and ignores sprite UVs", t => {
    const { model, atlas } = fixture(t);
    const shared = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    const geometry = shared.clone().translate(8, 8, 8);
    t.teardown(() => geometry.dispose());
    const firstCorners = [[16, -16], [0, -16], [0, 0], [0, -16], [0, -16], [-16, -16]];
    for (const [itemId, display, scale] of [
        ["minecraft:compass", DisplayPosition.GUI, 0.5],
        ["minecraft:recovery_compass", DisplayPosition.FIRSTPERSON_RIGHTHAND, 0.75],
        ["minecraft:clock", DisplayPosition.FIRSTPERSON_LEFTHAND, 0.75],
        ["minecraft:compass", DisplayPosition.THIRDPERSON_RIGHTHAND, 1],
        ["minecraft:clock", undefined, 1]
    ] as const) {
        ItemGlint.mapUvs(geometry, model.elements![0].faces, atlas, itemId, display);
        const projected = geometry.getAttribute("glintUv");
        const actual = CUBE_FACES.map((_, index) => [projected.getX(index * 4) + 0, projected.getY(index * 4) + 0]);
        t.deepEqual(actual, firstCorners.map(pair => pair.map(value => Math.fround(value / (2048 * scale)) + 0)));
    }
    const original = Array.from(geometry.getAttribute("glintUv").array);
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index++) uv.setXY(index, 0.375, 0.625);
    const packed = new TextureAtlas(model, { width: 128, height: 128 } as CanvasImage, { side: [64, 32] }, { side: [32, 16] }, false, {}, false);
    ItemGlint.mapUvs(geometry, model.elements![0].faces, packed, "minecraft:clock");
    t.deepEqual(Array.from(geometry.getAttribute("glintUv").array), original);
    geometry.getAttribute("normal").setXYZ(0, 1, 1, 0);
    ItemGlint.mapUvs(geometry, model.elements![0].faces, atlas, "minecraft:compass");
    t.is(geometry.getAttribute("glintUv").getY(0), 16 / 2048);
    ItemGlint.mapUvs(geometry, model.elements![0].faces, atlas, "custom:clock");
    t.deepEqual(Array.from(geometry.getAttribute("glintUv").array).slice(0, 2), [0.375 / 32, 0.375 / 32]);
    t.false(shared.hasAttribute("glintUv"));
});

test.serial("lodestone compass projection follows rotated elements before display transforms without changing shared atlas data", async t => {
    const { scene, model } = fixture(t);
    model.itemId = "minecraft:compass";
    model.components = { lodestone_tracker: {} };
    model.elements![0].rotation = { axis: Axis.Y, angle: 22.5, origin: [8, 8, 8], rescale: false };
    const before = JSON.stringify(model);
    const first = await scene.addModel(model, { displayPosition: DisplayPosition.GUI }) as ModelObject;
    const second = await scene.addModel({ ...model, display: { gui: {
        translation: [-9, 13, 4], rotation: [17, 43, -21], scale: [-1, 0.3, 2]
    } } }, { displayPosition: DisplayPosition.GUI }) as ModelObject;
    t.false(first.isInstanced);
    const getPass = (object: ModelObject) => {
        let pass: Mesh | undefined;
        object.iterateAllMeshes(mesh => { if (mesh.userData.minerenderItemGlint) pass = mesh; });
        return pass!;
    };
    const firstPass = getPass(first), secondPass = getPass(second);
    t.truthy(firstPass);
    t.truthy(secondPass);
    const firstUv = firstPass.geometry.getAttribute("glintUv"), secondUv = secondPass.geometry.getAttribute("glintUv");
    t.deepEqual(Array.from(firstUv.array), Array.from(secondUv.array));
    t.notDeepEqual(Array.from(firstPass.geometry.getAttribute("position").array), Array.from(secondPass.geometry.getAttribute("position").array));
    const z = 8 - 8 * Math.sin(Math.PI / 8) + 8 * Math.cos(Math.PI / 8);
    t.true(Math.abs(firstUv.getX(0) - z / 1024) < 1e-8);
    t.is(firstUv.getY(0), -16 / 1024);
    t.is(JSON.stringify(model), before);
});

test.serial("missing glint textures reject cleanly after releasing the ordinary item's owned resources", async t => {
    const { scene, model } = fixture(t);
    ModelTextures.get = async key => {
        await Caching.textureAssetCache.get(key.serialize(), async () => undefined);
        return undefined;
    };
    const create = Materials.createShadedCanvasMaterial;
    let materials = 0, textures = 0;
    Materials.createShadedCanvasMaterial = (...args) => {
        const material = create(...args) as ShaderMaterial;
        material.addEventListener("dispose", () => materials++);
        material.uniforms.map.value.addEventListener("dispose", () => textures++);
        return material;
    };
    await t.throwsAsync(scene.addModel({ ...model, components: { enchantment_glint_override: true } } as ItemModel), { message: /Missing item glint texture/ });
    t.deepEqual([materials, textures], [1, 1]);
    t.is(scene.children.length, 0);
});

test.serial("GUI count labels and durability bars scale with slots and draw above models before later layers", async t => {
    const { scene } = fixture(t);
    const { image, requests } = countFont(t);
    const layers = [
        { name: "background", texture: "test:gui/background", position: [10, 20] as [number, number], size: [32, 24] as [number, number] },
        { name: "item", item: "test:item/front", position: [10, 20] as [number, number], size: [32, 24] as [number, number],
            context: { count: 64, components: { damage: 50, max_damage: 100 } } },
        { name: "later", texture: "test:gui/overlay", position: [10, 20] as [number, number] }
    ];
    const before = JSON.stringify(layers);
    const gui = await scene.addGui(layers);
    gui.updateMatrixWorld(true);
    const item = gui.getGroupByName("item")!, overlays = gui.getGroupByName("item:overlays")!;
    const count = gui.getGroupByName("item:count")!;
    const background = gui.getMeshByName("item:durability-background")!, fill = gui.getMeshByName("item:durability-fill")!;
    const later = gui.getMeshByName("later")!, text = count.children as Mesh[];
    t.deepEqual(overlays.scale.toArray(), [2, 1.5, 1]);
    t.deepEqual(count.position.toArray(), [4, -9, 0]);
    const boxes = [background, fill].map(mesh => new Box3().setFromObject(mesh));
    t.deepEqual(boxes.map(box => [box.min.x, box.min.y, box.max.x, box.max.y]), [[14, -42.5, 40, -39.5], [14, -41, 28, -39.5]]);
    const colors = fill.geometry.getAttribute("color");
    t.deepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [1, 1, 0]);
    const ordered = [gui.getMeshByName("item")!, background, fill, ...text, later];
    t.true(ordered.every((mesh, index) => index === 0 || mesh.renderOrder > ordered[index - 1].renderOrder));
    t.true(new Box3().setFromObject(item).max.z < boxes[0].min.z);
    t.true(boxes[0].max.z < later.position.z);
    t.is(later.position.z, 0);
    const textMaterial = text[0].material as MeshBasicMaterial, barMaterial = background.material as MeshBasicMaterial;
    t.is(text[1].material, textMaterial);
    t.is(fill.material, barMaterial);
    t.is(textMaterial.map!.image, image);
    t.true([textMaterial, barMaterial].every(material => material.transparent && material.vertexColors && !material.depthWrite && !material.toneMapped));
    t.deepEqual(requests, [undefined]);
    t.is(JSON.stringify(layers), before);
    let geometries = 0, materials = 0, textures = 0;
    for (const mesh of [background, fill, ...text]) mesh.geometry.addEventListener("dispose", () => geometries++);
    for (const material of [textMaterial, barMaterial]) material.addEventListener("dispose", () => materials++);
    textMaterial.map!.addEventListener("dispose", () => textures++);
    gui.dispose(); gui.dispose();
    t.deepEqual([geometries, materials, textures], [4, 2, 1]);
});

test.serial("GUI durability uses supplied component presence, clamped widths, and vanilla colors without loading fonts", async t => {
    const { scene, requests } = fixture(t);
    const font = countFont(t);
    for (const [components, expected] of [
        [{ damage: 25, max_damage: 100 }, [10, 0x7fff00]],
        [{ "minecraft:damage": 75, "minecraft:max_damage": 100 }, [3, 0xff7f00]],
        [{ damage: 13, max_damage: 15 }, [2, 0xff4300]],
        [{ damage: 8388608, max_damage: 16777217 }, [7, 0xffff00]],
        [{ damage: 100, max_damage: 100 }, [0, 0]], [{ damage: 101, max_damage: 100 }, [0, 0]],
        [{ damage: 5e299, max_damage: 1e300 }, [7, 0xffff00]],
        [{ damage: -1, max_damage: 100 }, undefined], [{ damage: 0, max_damage: 100 }, undefined],
        [{ damage: 50 }, undefined], [{ max_damage: 100 }, undefined], [{ damage: 50, max_damage: 0 }, undefined],
        [{ damage: 50, max_damage: 100, unbreakable: {} }, undefined],
        [{ damage: 50, max_damage: 100, "minecraft:unbreakable": false }, undefined]
    ] as const) {
        const gui = await scene.addGui([{ name: "item", item: "test:item/front", context: { components } }]);
        const background = gui.getMeshByName("item:durability-background"), fill = gui.getMeshByName("item:durability-fill");
        t.is(!!background, expected !== undefined);
        t.is(!!fill, !!expected?.[0]);
        if (fill && expected) {
            fill.geometry.computeBoundingBox();
            t.is(fill.geometry.boundingBox!.max.x - fill.geometry.boundingBox!.min.x, expected[0]);
            const color = fill.geometry.getAttribute("color"), rgb = new Color(expected[1]).toArray();
            t.true([color.getX(0), color.getY(0), color.getZ(0)].every((value, index) => Math.abs(value - rgb[index]) < 1e-6));
        }
        t.is(gui.getGroupByName("item:count"), undefined);
    }
    t.deepEqual(font.requests, []);
    const before = requests.length;
    const empty = await scene.addGui([{ name: "empty", item: "test:item/missing", position: [10, 20], size: [32, 24], context: { count: 0 } }]);
    t.deepEqual([empty.bounds.min.toArray(), empty.bounds.max.toArray()], [[10, 20], [42, 44]]);
    t.deepEqual(empty.getGroupByName("empty")!.position.toArray(), [26, -32, 0]);
    t.is(empty.getGroupByName("empty")!.children.length, 0);
    t.is(requests.length, before);
    for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
        await t.throwsAsync(scene.addGui([{ item: "test:item/front", context: { count: count as number } }]), { message: /nonnegative safe integer/ });
    }
    for (const components of [{ damage: 1, max_damage: -1 }, { damage: "bad", max_damage: 100 }, { damage: 1, max_damage: null },
        { damage: 1, "minecraft:damage": 2, max_damage: 100 }]) {
        await t.throwsAsync(scene.addGui([{ item: "test:item/front", context: { components } }]));
    }
    t.is(requests.length, before);
});

test.serial("GUI item decorations can be disabled without changing stack state or empty slots", async t => {
    const { scene, requests } = fixture(t);
    const font = countFont(t);
    const gui = await scene.addGui([
        { name: "item", item: "test:item/front", decorations: false, context: { count: 64, components: { damage: 50, max_damage: 100 } } },
        { name: "empty", item: "test:item/missing", decorations: false, context: { count: 0 } }
    ]);
    t.truthy(gui.getMeshByName("item"));
    t.is(gui.getGroupByName("item:overlays"), undefined);
    t.is(gui.getGroupByName("empty")!.children.length, 0);
    t.is(requests.length, 1);
    t.deepEqual(font.requests, []);
});

test.serial("GUI durability inherits the requested item's defaults and preserves explicit overrides", async t => {
    const { scene } = fixture(t);
    for (const [item, components, expected] of [
        ["minecraft:item/diamond_pickaxe", { damage: 781 }, 6],
        [new AssetKey("minecraft", "bow", "models", "item"), { "minecraft:damage": 192 }, 7],
        ["item/elytra", { damage: 216 }, 7],
        ["item/diamond_pickaxe", { damage: 781, max_damage: 1562 }, 7],
        ["item/diamond_pickaxe", {}, undefined],
        ["item/diamond_pickaxe", { damage: 0 }, undefined],
        ["item/diamond_pickaxe", { damage: 781, max_damage: 0 }, undefined],
        ["item/diamond_pickaxe", { damage: 781, unbreakable: {} }, undefined],
        ["custom:item/diamond_pickaxe", { damage: 781 }, undefined],
        ["minecraft:item/unknown", { damage: 781 }, undefined],
        ["minecraft:block/diamond_pickaxe", { damage: 781 }, undefined]
    ] as const) {
        const before = JSON.stringify(components);
        const gui = await scene.addGui([{ name: "item", item, context: { components } }]);
        const fill = gui.getMeshByName("item:durability-fill");
        t.is(!!fill, expected !== undefined);
        if (fill) {
            fill.geometry.computeBoundingBox();
            t.is(fill.geometry.boundingBox!.max.x - fill.geometry.boundingBox!.min.x, expected);
        }
        t.is(JSON.stringify(components), before);
        gui.dispose();
    }
    await t.throwsAsync(scene.addGui([{ item: "item/diamond_pickaxe", context: { components: {
        damage: 781, max_damage: 1561, "minecraft:max_damage": 1562
    } } }]), { message: /Duplicate item-preview component/ });
});

test.serial("GUI overlays snapshot stack inputs before loading and include wide count labels in local bounds", async t => {
    const { scene, model } = fixture(t);
    countFont(t);
    model.display = {};
    const context = { count: 1000, components: { damage: 50, max_damage: 100 } };
    Models.getMerged = async () => { context.count = 1; context.components.damage = 0; return model; };
    const gui = new GuiObject([{ name: "item", item: "test:item/front", position: [10, 20], size: [32, 24], context }]);
    gui.position.set(200, 100, 30);
    gui.rotation.z = Math.PI / 2;
    gui.scale.setScalar(2);
    scene.add(gui);
    await gui.init();
    t.deepEqual(gui.getGroupByName("item:count")!.position.toArray(), [-8, -9, 0]);
    t.truthy(gui.getMeshByName("item:durability-fill"));
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()].map(point => point.map(value => Math.round(value * 1e6) / 1e6)), [[-6, 20], [43.5, 47]]);
});

test.serial("GUI items preserve their display pose, tint, and source key within ordered pixel layers", async t => {
    const { scene, model, requests } = fixture(t);
    model.tints = [{ type: "minecraft:constant", value: 0x0000ff }];
    const item = new AssetKey("test", "front", "models", "item", "assets", ".json", "custom-root");
    const layers = [
        { name: "background", texture: "test:gui/background", position: [10, 20] as [number, number], size: [32, 16] as [number, number] },
        { name: "item", item, position: [10, 20] as [number, number], size: [32, 16] as [number, number], tints: { 0: 0xff0000 } },
        { name: "overlay", texture: "test:gui/overlay", position: [10, 20] as [number, number], size: [32, 16] as [number, number] }
    ];
    const original = JSON.stringify([layers, model]);
    const gui = await scene.addGui(layers);
    gui.updateMatrixWorld(true);
    const mesh = gui.getMeshByName("item")!, material = mesh.material as ShaderMaterial;
    const box = new Box3().setFromObject(mesh);
    t.deepEqual([box.min.x, box.min.y, box.max.x, box.max.y], [34, -29, 66, -21]);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[10, 20], [66, 36]]);
    t.is(mesh.parent, gui.getGroupByName("item"));
    t.is(requests[0], item);
    t.false(gui.isInstanced);
    t.false(material.uniforms.SHADE.value);
    t.true(material.transparent && material.depthTest && material.depthWrite);
    const colors = mesh.geometry.getAttribute("color");
    t.deepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [1, 0, 0]);
    const background = gui.getMeshByName("background")!, overlay = gui.getMeshByName("overlay")!;
    t.true(background.renderOrder < mesh.renderOrder && mesh.renderOrder < overlay.renderOrder);
    t.true(background.position.z < box.min.z && box.max.z < overlay.position.z);
    t.is(overlay.position.z, 0);
    const side = await scene.addGui([{ name: "side", item: "test:item/side" }]);
    const sideMesh = side.getMeshByName("side")!;
    t.true((sideMesh.material as ShaderMaterial).uniforms.SHADE.value);
    t.false(sideMesh.geometry.hasAttribute("color"));
    t.deepEqual(side.getGroupByName("side")!.position.toArray().slice(0, 2), [8, -8]);
    t.deepEqual(side.getGroupByName("side")!.scale.toArray().slice(0, 2), [1, 1]);
    t.is(requests[1].toNamespacedString(), "test:item/side");
    const defaults = await scene.addGui([{ name: "default", item }]);
    const defaultColors = defaults.getMeshByName("default")!.geometry.getAttribute("color");
    t.deepEqual([defaultColors.getX(0), defaultColors.getY(0), defaultColors.getZ(0)], [0, 0, 1]);
    t.deepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [1, 0, 0]);
    t.is(JSON.stringify([layers, model]), original);
});

test.serial("GUI item contexts keep component colors separate and preserve explicit overrides", async t => {
    const { scene, model } = fixture(t);
    model.tints = [{ type: "minecraft:dye", default: 0x0000ff }];
    Models.getMerged = async (_key, context) => {
        t.is(context?.displayContext, "gui");
        return { ...model, components: context?.components };
    };
    const context = { components: { "minecraft:dyed_color": 0xff0000 }, properties: { display_context: "ground" } };
    const layers = [
        { name: "red", item: "test:item/front", context },
        { name: "black", item: "test:item/front", context, tints: { 0: 0 } },
        { name: "default", item: "test:item/front" }
    ];
    const original = JSON.stringify(layers);
    const gui = await scene.addGui(layers);
    for (const [name, expected] of [["red", [1, 0, 0]], ["black", [0, 0, 0]], ["default", [0, 0, 1]]] as const) {
        const color = gui.getMeshByName(name)!.geometry.getAttribute("color");
        t.deepEqual([color.getX(0), color.getY(0), color.getZ(0)], [...expected]);
    }
    t.is(JSON.stringify(layers), original);
    t.is(model.components, undefined);
});

test.serial("GUI disposal releases item resources and subscriptions while retaining the shared atlas", async t => {
    const { scene, model, atlas, imageDisposals } = fixture(t);
    const sharedGeometry = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    let sharedDisposals = 0;
    sharedGeometry.addEventListener("dispose", () => sharedDisposals++);
    const first = await scene.addGui([{ name: "item", item: "test:item/front" }]);
    const second = await scene.addGui([{ name: "item", item: "test:item/front" }]);
    const mesh = first.getMeshByName("item")!, material = mesh.material as ShaderMaterial;
    const texture = material.uniforms.map.value, liveTexture = (second.getMeshByName("item")!.material as ShaderMaterial).uniforms.map.value;
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
    mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
    material.addEventListener("dispose", () => materialDisposals++);
    texture.addEventListener("dispose", () => textureDisposals++);
    first.dispose(); first.dispose();
    t.deepEqual([geometryDisposals, materialDisposals, textureDisposals], [1, 1, 1]);
    const versions = [texture.version, liveTexture.version];
    scene.dirty = false;
    Ticker.tickers.get(atlas.ticker!)!();
    t.true(scene.dirty);
    t.deepEqual([texture.version, liveTexture.version], [versions[0], versions[1] + 1]);
    second.dispose();
    t.is(atlas.ticker, undefined);
    t.deepEqual([sharedDisposals, imageDisposals()], [0, 0]);

    const before = [...scene.children];
    const create = Materials.createShadedCanvasMaterial;
    let failedMaterialDisposals = 0, failedTextureDisposals = 0;
    Materials.createShadedCanvasMaterial = (...args) => {
        const material = create(...args) as ShaderMaterial;
        material.addEventListener("dispose", () => failedMaterialDisposals++);
        material.uniforms.map.value.addEventListener("dispose", () => failedTextureDisposals++);
        return material;
    };
    await t.throwsAsync(scene.addGui([{ item: "test:item/front" }, { item: "test:item/missing" }]));
    t.deepEqual([failedMaterialDisposals, failedTextureDisposals], [1, 1]);
    t.is(atlas.ticker, undefined);
    t.deepEqual(scene.children, before);
    t.deepEqual([sharedDisposals, imageDisposals()], [0, 0]);
});

test.serial("special GUI items include nested poses in local bounds and own only their material copies", async t => {
    const { scene, model } = fixture(t);
    model.special = { type: "minecraft:chest", texture: "minecraft:normal" };
    model.display = {};
    const texture = AssetKey.parse("textures", "minecraft:entity/chest/normal");
    const original = Entities.getEntity;
    Entities.getEntity = async key => ({
        key, texture, id: "chest", layer: { texture: [16, 16], root: {
            pose: { offset: [30, 0, 0], rotation: [0, 0, Math.PI / 2] }, cubes: [], children: {
                cube: { pose: { offset: [4, 0, 0], rotation: [0, 0, 0] }, children: {},
                    cubes: [{ origin: [0, 0, 0], size: [4, 2, 2], uv: [0, 0] }] }
            }
        } }
    });
    t.teardown(() => { Entities.getEntity = original; });
    const shared = Materials.createEntityCanvasMaterial({ width: 16, height: 16 } as HTMLCanvasElement, "solid");
    Caching.materialCache.get(`entity:solid::${texture.serialize()}`, () => shared);
    const gui = new GuiObject([
        { name: "background", texture: "test:gui/background", position: [10, 20] },
        { name: "item", item: "minecraft:item/chest", position: [10, 20] },
        { name: "overlay", texture: "test:gui/overlay", position: [10, 20] }
    ]);
    gui.position.set(200, 100, 30);
    gui.rotation.z = Math.PI / 2;
    gui.scale.setScalar(2);
    scene.add(gui);
    await gui.init();
    gui.updateWorldMatrix(true, true);
    const mesh = gui.getMeshByName("item")!, material = mesh.material as MeshBasicMaterial;
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(new Matrix4().multiplyMatrices(gui.matrixWorld.clone().invert(), mesh.matrixWorld));
    t.deepEqual([box.min.x, box.min.y, box.max.x, box.max.y].map(Math.round), [38, -32, 40, -28]);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()].map(point => point.map(Math.round)), [[10, 20], [40, 36]]);
    const background = gui.getMeshByName("background")!, overlay = gui.getMeshByName("overlay")!;
    t.true(background.renderOrder < mesh.renderOrder && mesh.renderOrder < overlay.renderOrder);
    t.true(background.position.z < box.min.z && box.max.z < overlay.position.z);
    t.not(material, shared);
    t.is(material.map, shared.map);
    t.true(material.transparent);
    t.false(shared.transparent);
    let geometryDisposals = 0, materialDisposals = 0, sharedDisposals = 0, textureDisposals = 0;
    mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
    material.addEventListener("dispose", () => materialDisposals++);
    shared.addEventListener("dispose", () => sharedDisposals++);
    shared.map!.addEventListener("dispose", () => textureDisposals++);
    gui.dispose(); gui.dispose();
    t.deepEqual([geometryDisposals, materialDisposals, sharedDisposals, textureDisposals], [1, 1, 0, 0]);
});
