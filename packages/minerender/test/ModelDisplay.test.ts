import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { InstanceReference } from "../src/instance/InstanceReference";
import { Materials } from "../src/Materials";
import { DisplayPosition } from "../src/model/DisplayPosition";
import { DisplayTransforms } from "../src/model/DisplayTransforms";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { Model } from "../src/model/Model";

function fixture(t: ExecutionContext) {
    const originals = { atlas: UVMapper.getAtlas, material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    Caching.clear();
    t.teardown(() => {
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        Materials.createShadedCanvasMaterial = originals.shaded;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    const model: Model = {
        key: new AssetKey("test", "display", "models", "item"),
        display: {
            gui: { translation: [3, 5, 7], rotation: [0, 0, 90], scale: [2, 1, 1] },
            ground: { translation: [0, 10, 0] },
            fixed: { scale: [-1, 1, 1] }
        },
        textures: { side: "block/stone" },
        elements: [{
            from: [8, 8, 8], to: [10, 12, 14],
            faces: Object.fromEntries(CUBE_FACES.map(name => [name, { texture: "#side" }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }]
    };
    const image = { width: 16, height: 16, canvas: {} } as CanvasImage;
    const atlas = new TextureAtlas(model, image, { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    UVMapper.getAtlas = async () => atlas;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    return { scene, model, atlas };
}

function geometry(model: ModelObject) {
    return (model.children[0] as Mesh).geometry;
}

function coordinates(vector: Vector3): number[] {
    return vector.toArray().map(value => Math.round(value * 1e6) / 1e6);
}

test.serial("display poses scale and rotate around the model center before translation, only when selected", async t => {
    const { scene, model, atlas } = fixture(t);
    const base = Geometries.getBox({ width: 2, height: 4, depth: 6, uv: model.elements![0].mappedUv });
    const basePositions = Array.from(base.getAttribute("position").array);
    const baseUvs = Array.from(base.getAttribute("uv").array);
    const original = JSON.stringify([model, atlas.positions, atlas.sizes]);
    const displayed = await scene.addModel(model, { instanceMeshes: false, mergeMeshes: false, displayPosition: DisplayPosition.GUI }) as ModelObject;
    const plain = await scene.addModel(model, { instanceMeshes: false }) as ModelObject;
    const absent = await scene.addModel(model, { instanceMeshes: false, displayPosition: DisplayPosition.ON_SHELF }) as ModelObject;

    geometry(displayed).computeBoundingBox();
    geometry(plain).computeBoundingBox();
    t.deepEqual(coordinates(geometry(displayed).boundingBox!.min), [-1, 5, 7]);
    t.deepEqual(coordinates(geometry(displayed).boundingBox!.max), [3, 9, 13]);
    t.deepEqual(coordinates(geometry(plain).boundingBox!.min), [0, 0, 0]);
    t.deepEqual(coordinates(geometry(plain).boundingBox!.max), [2, 4, 6]);
    t.deepEqual(Array.from(geometry(absent).getAttribute("position").array), Array.from(geometry(plain).getAttribute("position").array));
    t.deepEqual(Array.from(base.getAttribute("position").array), basePositions);
    t.deepEqual(Array.from(base.getAttribute("uv").array), baseUvs);
    t.deepEqual(Array.from(geometry(displayed).getAttribute("uv").array), baseUvs);
    t.is(JSON.stringify([model, atlas.positions, atlas.sizes]), original);
    t.is(displayed.textureAtlas, atlas);
});

test.serial("hand poses mirror translation and rotations, clamp vanilla limits, and retain outward winding", async t => {
    const display: Model["display"] = {
        firstperson_righthand: { translation: [2, 3, 4], rotation: [90, 90, 90] },
        thirdperson_righthand: { translation: [100, -100, 5], scale: [5, -5, 2] }
    };
    const point = (position: DisplayPosition) => coordinates(new Vector3(1, 2, 3).applyMatrix4(DisplayTransforms.getMatrix(display, position)));
    t.deepEqual(point(DisplayPosition.FIRSTPERSON_RIGHTHAND), [5, 1, 5]);
    t.deepEqual(point(DisplayPosition.FIRSTPERSON_LEFTHAND), [-5, 1, 3]);
    t.deepEqual(point(DisplayPosition.THIRDPERSON_RIGHTHAND), [84, -88, 11]);
    t.deepEqual(point(DisplayPosition.THIRDPERSON_LEFTHAND), [-76, -88, 11]);

    const { scene, model } = fixture(t);
    const base = Geometries.getBox({ width: 2, height: 4, depth: 6, uv: model.elements![0].mappedUv });
    const baseIndices = Array.from(base.index!.array);
    const mirrored = await scene.addModel(model, { instanceMeshes: false, displayPosition: DisplayPosition.FIXED }) as ModelObject;
    const geo = geometry(mirrored);
    t.deepEqual(coordinates(geo.boundingBox!.min), [-2, 0, 0]);
    t.deepEqual(coordinates(geo.boundingBox!.max), [0, 4, 6]);
    t.deepEqual(Array.from(base.index!.array), baseIndices);
    const positions = geo.getAttribute("position");
    const normals = geo.getAttribute("normal");
    const index = geo.index!;
    for (let i = 0; i < index.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(positions, index.getX(i));
        const b = new Vector3().fromBufferAttribute(positions, index.getX(i + 1));
        const c = new Vector3().fromBufferAttribute(positions, index.getX(i + 2));
        const normal = new Vector3().fromBufferAttribute(normals, index.getX(i));
        t.true(b.sub(a).cross(c.sub(a)).dot(normal) > 0);
    }
});

test.serial("display contexts have separate instance pools and caller placement stays outside the baked pose", async t => {
    const { scene, model, atlas } = fixture(t);
    const plain = await scene.addModel(model) as InstanceReference<ModelObject>;
    const gui = await scene.addModel(model, { displayPosition: DisplayPosition.GUI }) as InstanceReference<ModelObject>;
    const ground = await scene.addModel(model, { displayPosition: DisplayPosition.GROUND }) as InstanceReference<ModelObject>;
    const secondGui = await scene.addModel(model, { displayPosition: DisplayPosition.GUI }) as InstanceReference<ModelObject>;
    t.is(scene.children.length, 3);
    t.is(gui.instanceable, secondGui.instanceable);
    t.not(gui.instanceable, plain.instanceable);
    t.not(gui.instanceable, ground.instanceable);
    t.deepEqual([plain.instanceable.instanceCounter, gui.instanceable.instanceCounter, ground.instanceable.instanceCounter], [1, 2, 1]);
    t.is(gui.instanceable.textureAtlas, atlas);
    t.is(ground.instanceable.textureAtlas, atlas);

    gui.setPosition(new Vector3(20, 30, 40));
    secondGui.setPosition(new Vector3(-10, 0, 0));
    const box = geometry(gui.instanceable).boundingBox!.clone();
    box.applyMatrix4(gui.getMatrix());
    t.deepEqual(coordinates(box.min), [19, 35, 47]);
    t.deepEqual(coordinates(box.max), [23, 39, 53]);
    t.deepEqual(coordinates(secondGui.getPosition()), [-10, 0, 0]);
    t.deepEqual(coordinates(plain.getPosition()), [0, 0, 0]);
    t.deepEqual(coordinates(ground.getPosition()), [0, 0, 0]);
});
