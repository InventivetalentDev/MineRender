import test, { type ExecutionContext } from "ava";
import { Box3, MeshBasicMaterial, ShaderMaterial, Vector3 } from "three";
import type { Mesh } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Entities } from "../src/assets/Entities";
import { Models } from "../src/assets/Models";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import { CUBE_FACES } from "../src/CubeFace";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import { Geometries } from "../src/Geometries";
import { GuiObject } from "../src/gui/scene/GuiObject";
import { Materials } from "../src/Materials";
import { DisplayPosition } from "../src/model/DisplayPosition";
import { GuiLight } from "../src/model/GuiLight";
import type { ItemModel } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { SceneDocumentLoader } from "../src/scene/SceneDocumentLoader";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { Ticker } from "../src/Ticker";
import { UVMapper } from "../src/UVMapper";

const coordinates = (value: Vector3) => value.toArray().map(number => Math.round(number * 1e6) / 1e6);
const meshes = (object: ModelObject | GuiObject): Mesh[] => {
    const result: Mesh[] = [];
    object.iterateAllMeshes(mesh => result.push(mesh));
    return result;
};

function fixture(t: ExecutionContext) {
    const original = { merged: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage,
        texture: ModelTextures.get, meta: ModelTextures.getMeta, entity: Entities.getEntity };
    const scene = new MineRenderScene(), placeholder = new MeshBasicMaterial();
    const objects: ModelObject[] = [];
    const canvas = { width: 16, height: 16 };
    let imageDisposals = 0;
    const image = { ...canvas, canvas, dispose: () => imageDisposals++ } as unknown as CanvasImage;
    const front: ItemModel = {
        key: AssetKey.parse("models", "test:item/front"), gui_light: GuiLight.FRONT,
        display: { gui: { translation: [-12, 0, 0], scale: [0.5, 0.5, 0.5] } },
        tints: [{ type: "minecraft:dye", default: 0xffffff }], components: { "minecraft:dyed_color": 0xff0000 },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", tintindex: 0 }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0]) }]
    };
    const side: ItemModel = { ...front, key: AssetKey.parse("models", "test:item/side"), gui_light: GuiLight.SIDE,
        display: { gui: { translation: [12, 0, 0], scale: [0.25, 0.25, 0.25] } },
        tints: [{ type: "minecraft:constant", value: 0x0000ff }] };
    const special: ItemModel = {
        key: AssetKey.parse("models", "test:item/chest"), gui_light: GuiLight.FRONT,
        display: { gui: { translation: [0, 8, 0] } }, special: { type: "minecraft:chest", texture: "test:normal" }
    };
    const composite: ItemModel = { key: AssetKey.parse("models", "test:item/composite"),
        parts: [front, { key: AssetKey.parse("models", "test:item/nested"), parts: [side, special] }] };
    const frontAtlas = new TextureAtlas(front, image, { side: [16, 16] }, { side: [0, 0] }, true, { side: () => true }, false);
    const sideAtlas = new TextureAtlas(side, image, frontAtlas.sizes, frontAtlas.positions, false, {}, true);
    Caching.clear();
    const entityTexture = AssetKey.parse("textures", "test:entity/chest");
    const sharedEntityMaterial = Materials.createEntityCanvasMaterial(canvas as HTMLCanvasElement, "solid");
    Caching.materialCache.get(`entity:solid::${entityTexture.serialize()}`, () => sharedEntityMaterial);
    Models.getMerged = async () => composite;
    UVMapper.getAtlas = async model => {
        if (model === front) return frontAtlas;
        if (model === side) return sideAtlas;
        throw new Error(`Unexpected atlas for ${model.key?.toNamespacedString()}`);
    };
    Materials.getImage = () => placeholder;
    ModelTextures.getMeta = async () => undefined;
    ModelTextures.get = async () => ({ ...canvas, data: { canvas } } as unknown as ExtractableImageData);
    Entities.getEntity = async key => ({ key, id: "chest", texture: entityTexture, layer: { texture: [16, 16], root: {
        pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, children: {},
        cubes: [{ origin: [0, 0, 0], size: [2, 2, 2], uv: [0, 0] }]
    } } });
    t.teardown(() => {
        for (const object of objects) object.dispose();
        for (const object of [...scene.children]) {
            if ("dispose" in object) (object as { dispose(): void }).dispose();
            object.removeFromParent();
        }
        Models.getMerged = original.merged; UVMapper.getAtlas = original.atlas;
        Materials.getImage = original.image; ModelTextures.get = original.texture;
        ModelTextures.getMeta = original.meta; Entities.getEntity = original.entity;
        frontAtlas.dispose(); sideAtlas.dispose(); placeholder.dispose(); sharedEntityMaterial.dispose();
        Caching.clear();
    });
    return { scene, composite, front, side, frontAtlas, sharedEntityMaterial, objects, imageDisposals: () => imageDisposals };
}

test.serial("composite scene items and document items preserve each child's pose, tint, and lighting", async t => {
    const { scene, composite } = fixture(t);
    const original = JSON.stringify(composite);
    const object = await scene.addModel(composite, { instanceMeshes: true, displayPosition: DisplayPosition.GUI }) as ModelObject;
    t.true(object.isModelObject);
    t.false(object.isInstanced);
    const drawn = meshes(object);
    t.is(drawn.length, 3);
    t.true(drawn[0].renderOrder < drawn[1].renderOrder && drawn[1].renderOrder < drawn[2].renderOrder);
    const front = drawn[0].material as ShaderMaterial, side = drawn[1].material as ShaderMaterial;
    t.false(front.uniforms.SHADE.value);
    t.true(side.uniforms.SHADE.value);
    t.true(drawn.every(mesh => (mesh.material as MeshBasicMaterial).transparent));
    t.deepEqual(drawn.slice(0, 2).map(mesh => {
        const color = mesh.geometry.getAttribute("color");
        return [color.getX(0), color.getY(0), color.getZ(0)];
    }), [[1, 0, 0], [0, 0, 1]]);
    const bounds = new Box3().setFromObject(object);
    t.deepEqual([coordinates(bounds.min), coordinates(bounds.max)], [[-16, -4, -8], [14, 4, 4]]);
    object.dispose(); object.removeFromParent();

    const document = await SceneDocumentLoader.load(scene, {
        format: "minerender-scene", version: 1,
        objects: [{ id: "composite", type: "item", asset: "test:composite", position: [100, 0, 0] }]
    });
    t.teardown(() => document.dispose());
    t.is(meshes(document.objects[0].object as ModelObject).length, 3);
    const documentBounds = new Box3().setFromObject(document.root);
    t.deepEqual([coordinates(documentBounds.min), coordinates(documentBounds.max)], [[84, -4, -8], [114, 4, 4]]);
    document.dispose();
    t.is(scene.children.length, 0);
    t.is(JSON.stringify(composite), original);
});

test.serial("composite GUI layers retain child order and bounds and dispose each owned resource once", async t => {
    const { scene, front, sharedEntityMaterial, frontAtlas, imageDisposals } = fixture(t);
    const sharedGeometry = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: front.elements![0].mappedUv });
    let sharedDisposals = 0;
    sharedGeometry.addEventListener("dispose", () => sharedDisposals++);
    sharedEntityMaterial.addEventListener("dispose", () => sharedDisposals++);
    sharedEntityMaterial.map!.addEventListener("dispose", () => sharedDisposals++);
    const gui = await scene.addGui([
        { name: "background", texture: "test:gui/background", position: [10, 20], size: [32, 16] },
        { name: "composite", item: "test:item/composite", position: [10, 20], size: [32, 16], tints: { 0: 0x00ff00 } },
        { name: "overlay", texture: "test:gui/overlay", position: [10, 20], size: [32, 16] }
    ]);
    const item = gui.getGroupByName("composite")! as ModelObject;
    const drawn = meshes(item);
    const background = gui.getMeshByName("background")!, overlay = gui.getMeshByName("overlay")!;
    t.true(background.renderOrder < drawn[0].renderOrder && drawn[2].renderOrder < overlay.renderOrder);
    t.true(drawn[0].renderOrder < drawn[1].renderOrder && drawn[1].renderOrder < drawn[2].renderOrder);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[-6, 20], [54, 36]]);
    for (const mesh of drawn.slice(0, 2)) {
        const color = mesh.geometry.getAttribute("color");
        t.deepEqual([color.getX(0), color.getY(0), color.getZ(0)], [0, 1, 0]);
    }
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
    for (const mesh of drawn) {
        mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
        (mesh.material as MeshBasicMaterial).addEventListener("dispose", () => materialDisposals++);
    }
    for (const mesh of drawn.slice(0, 2)) {
        (mesh.material as ShaderMaterial).uniforms.map.value.addEventListener("dispose", () => textureDisposals++);
    }
    gui.dispose(); gui.dispose();
    t.deepEqual([geometryDisposals, materialDisposals, textureDisposals, sharedDisposals, imageDisposals()], [3, 3, 2, 0, 0]);
    t.is(frontAtlas.ticker, undefined);
});

test.serial("composite animation pauses on detachment and partial initialization releases earlier parts", async t => {
    const { scene, composite, front, frontAtlas, objects } = fixture(t);
    const object = new ModelObject(composite, { displayPosition: DisplayPosition.GUI });
    objects.push(object);
    object.scene = scene;
    await object.init();
    t.is(frontAtlas.ticker, undefined);
    scene.add(object);
    const texture = (meshes(object)[0].material as ShaderMaterial).uniforms.map.value;
    const version = texture.version;
    scene.dirty = false;
    Ticker.tickers.get(frontAtlas.ticker!)!();
    t.true(scene.dirty);
    t.is(texture.version, version + 1);
    object.removeFromScene();
    t.is(frontAtlas.ticker, undefined);
    scene.add(object);
    t.not(frontAtlas.ticker, undefined);
    object.dispose(); object.removeFromParent();
    t.is(frontAtlas.ticker, undefined);

    const broken = new ModelObject({ parts: [front, { key: AssetKey.parse("models", "test:item/broken") }] } as ItemModel);
    objects.push(broken);
    const atlas = UVMapper.getAtlas;
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
    UVMapper.getAtlas = async model => {
        if (model.key?.path !== "broken") return atlas(model);
        for (const mesh of meshes(broken)) {
            mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
            const material = mesh.material as ShaderMaterial;
            material.addEventListener("dispose", () => materialDisposals++);
            material.uniforms.map.value.addEventListener("dispose", () => textureDisposals++);
        }
        throw new Error("Broken composite child");
    };
    await t.throwsAsync(broken.init(), { message: "Broken composite child" });
    t.is(broken.children.length, 0);
    t.deepEqual([geometryDisposals, materialDisposals, textureDisposals], [1, 1, 1]);
    t.is(frontAtlas.ticker, undefined);
});

test.serial("empty composites have no fallback mesh and preserve finite GUI slot bounds", async t => {
    const { scene } = fixture(t);
    const empty: ItemModel = { key: AssetKey.parse("models", "test:item/empty"), parts: [] };
    const object = await scene.addModel(empty) as ModelObject;
    t.false(object.isInstanced);
    t.deepEqual(meshes(object), []);
    Models.getMerged = async () => empty;
    const gui = await scene.addGui([
        { name: "empty", item: "test:item/empty", position: [3, 5] },
        { name: "overlay", texture: "test:gui/overlay", position: [3, 5] }
    ]);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[3, 5], [19, 21]]);
    t.true(Number.isFinite(gui.getGroupByName("empty")!.position.z));
    t.true(Number.isFinite(gui.getMeshByName("overlay")!.position.z));
});
