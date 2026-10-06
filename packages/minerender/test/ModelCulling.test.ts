import test, { ExecutionContext } from "ava";
import { Euler, Mesh, MeshBasicMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Axis } from "../src/Axis";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { InstanceReference, isInstanceReference } from "../src/instance/InstanceReference";
import { Materials } from "../src/Materials";
import { DisplayPosition } from "../src/model/DisplayPosition";
import { Model } from "../src/model/Model";
import { ModelCulling } from "../src/model/ModelCulling";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";

function cube(): Model {
    return {
        key: new AssetKey("test", "cube", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", cullface: face, tintindex: 0 }])),
            mappedUv: CUBE_FACES.flatMap(() => [0.5, 1, 1, 1, 0.5, 0.5, 1, 0.5])
        }]
    };
}

function atlas(model = cube(), transparent = false): TextureAtlas {
    return new TextureAtlas(model, { width: 32, height: 32, canvas: {} } as CanvasImage,
        { side: [16, 16] }, { side: [16, 0] }, false, {}, transparent);
}

function fixture(t: ExecutionContext) {
    const original = { atlas: UVMapper.getAtlas, material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial();
    const model = cube();
    const textureAtlas = atlas(model);
    const scene = new MineRenderScene();
    Caching.clear();
    UVMapper.getAtlas = async () => textureAtlas;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    t.teardown(() => {
        UVMapper.getAtlas = original.atlas;
        Materials.getImage = original.material;
        Materials.createShadedCanvasMaterial = original.shaded;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    return { scene, model, textureAtlas };
}

test("world masks follow cardinal block rotations and ignore non-cardinal transforms", t => {
    t.is(ModelCulling.toLocalMask(1 | 8, new Euler()), 1 | 8);
    t.is(ModelCulling.toLocalMask(16, new Euler(0, -Math.PI / 2, 0)), 1);
    t.is(ModelCulling.toLocalMask(1, new Euler(0, -Math.PI / 2, 0)), 32);
    t.is(ModelCulling.toLocalMask(16, new Euler(Math.PI / 2, 0, 0)), 4);
    t.is(ModelCulling.toLocalMask(1 | 4, new Euler(Math.PI / 2, Math.PI / 2, 0)), 1 | 16);
    t.is(ModelCulling.toLocalMask(63, new Euler(Math.PI, -Math.PI / 2, 0)), 63);
    t.is(ModelCulling.toLocalMask(63, new Euler(0, Math.PI / 4, 0)), 0);
});

test("only complete cubes with opaque mapped face textures prove occlusion", t => {
    t.true(ModelCulling.isOpaqueFullCube(atlas()));
    t.false(ModelCulling.isOpaqueFullCube(undefined));
    t.false(ModelCulling.isOpaqueFullCube(atlas(cube(), true)));
    const changes: Array<(value: TextureAtlas) => void> = [
        value => { value.model.elements![0].to[1] = 8; },
        value => { value.model.elements!.push(structuredClone(value.model.elements![0])); },
        value => { value.model.elements![0].rotation = { axis: Axis.Y, angle: 22.5, origin: [8, 8, 8], rescale: false }; },
        value => { delete value.model.elements![0].faces.east; },
        value => { value.model.elements![0].faces.east!.texture = "block/stone"; },
        value => { delete value.positions.side; },
        value => { delete value.sizes.side; },
        value => { delete value.model.elements![0].mappedUv; },
        value => { value.model.elements![0].mappedUv![0] = 0; }
    ];
    for (const change of changes) {
        const value = atlas();
        change(value);
        t.false(ModelCulling.isOpaqueFullCube(value));
    }
});

test.serial("cullface directions remove only their triangles while preserving transformed vertices, UVs and tints", async t => {
    const { scene, model } = fixture(t);
    const element = model.elements![0];
    element.faces.east!.cullface = "north";
    delete element.faces.west!.cullface;
    element.rotation = { axis: Axis.Y, angle: 22.5, origin: [8, 8, 8], rescale: false };
    const source = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: element.mappedUv });
    const sourceIndices = Array.from(source.index!.array);
    const options = { instanceMeshes: false, tints: { 0: 0x808080 }, uvLockRotation: [0, Math.PI / 2, 0] as [number, number, number] };
    const plain = await scene.addModel(model, options) as ModelObject;
    const culled = await scene.addModel(model, { ...options, cullMask: 1 | 2 | 32 }) as ModelObject;
    const before = (plain.children[0] as Mesh).geometry;
    const after = (culled.children[0] as Mesh).geometry;
    t.deepEqual(Array.from(after.index!.array), sourceIndices.slice(6, 30));
    for (const name of ["position", "normal", "uv", "color"]) {
        t.deepEqual(Array.from(after.getAttribute(name).array), Array.from(before.getAttribute(name).array));
    }
    t.deepEqual(Array.from(source.index!.array), sourceIndices);
});

test.serial("fully culled models retain empty indexed meshes and source-based opacity", async t => {
    const { scene, model } = fixture(t);
    for (const options of [
        { mergeMeshes: true, instanceMeshes: false },
        { mergeMeshes: false, instanceMeshes: false },
        { mergeMeshes: true, instanceMeshes: true }
    ]) {
        const result = await scene.addModel(model, { ...options, cullMask: 63 });
        const object = isInstanceReference(result) ? result.instanceable : result;
        t.is((object.children[0] as Mesh).geometry.index!.count, 0);
        t.true(object.isOpaqueFullCube);
    }
    const displayed = await scene.addModel(model, { instanceMeshes: false, displayPosition: DisplayPosition.GUI }) as ModelObject;
    t.false(displayed.isOpaqueFullCube);
});

test.serial("instance pools distinguish culling masks while sharing matching masks and the atlas", async t => {
    const { scene, model, textureAtlas } = fixture(t);
    const add = (cullMask?: number) => scene.addModel(model, { cullMask }) as Promise<InstanceReference<ModelObject>>;
    const plain = await add();
    const zero = await add(0);
    const east = await add(1);
    const same = await add(1);
    const west = await add(2);
    t.is(plain.instanceable, zero.instanceable);
    t.is(east.instanceable, same.instanceable);
    t.not(east.instanceable, plain.instanceable);
    t.not(west.instanceable, east.instanceable);
    t.is(scene.children.length, 3);
    t.is(east.instanceable.textureAtlas, textureAtlas);
    t.is(plain.instanceable.textureAtlas, textureAtlas);
});
