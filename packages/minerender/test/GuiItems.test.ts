import test, { ExecutionContext } from "ava";
import { Box3, Matrix4, MeshBasicMaterial, ShaderMaterial } from "three";
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

function fixture(t: ExecutionContext) {
    const originals = { merged: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage,
        texture: ModelTextures.get, shaded: Materials.createShadedCanvasMaterial };
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
        Materials.createShadedCanvasMaterial = originals.shaded;
        atlas.dispose(); sideAtlas.dispose(); placeholder.dispose(); Caching.clear();
    });
    return { scene, model, atlas, requests, imageDisposals: () => imageDisposals };
}

test.serial("GUI items preserve their display pose, tint, and source key within ordered pixel layers", async t => {
    const { scene, model, requests } = fixture(t);
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
    t.is(JSON.stringify([layers, model]), original);
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
