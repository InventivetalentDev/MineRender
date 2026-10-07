import test, { ExecutionContext } from "ava";
import { InstancedMesh, Mesh, MeshBasicMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES, CubeFace } from "../src/CubeFace";
import { Env, EnvProvider } from "../src/Env";
import { Materials } from "../src/Materials";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { UVMapper } from "../src/UVMapper";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { BlockStateVariant } from "../src/model/block/BlockState";
import type { ElementFace } from "../src/model/ElementFace";
import type { Model } from "../src/model/Model";

async function fixture(t: ExecutionContext, face: Partial<ElementFace> = {}) {
    const originals = {
        provider: Env["_provider"], model: Models.getMerged, texture: ModelTextures.get,
        meta: ModelTextures.getMeta,
        material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial
    };
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    Caching.clear();
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        Models.getMerged = originals.model;
        ModelTextures.get = originals.texture;
        ModelTextures.getMeta = originals.meta;
        Materials.getImage = originals.material;
        Materials.createShadedCanvasMaterial = originals.shaded;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    const pixels = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
    Env.register({
        name: "test",
        createCanvas: (width, height) => ({
            width, height, getContext: () => ({
                createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
                putImageData() {}, clearRect() {}
            }), toDataURL: () => ""
        } as unknown as CompatCanvas)
    } as EnvProvider);
    ModelTextures.get = async () => ({ width: 16, height: 16, data: { getImageData: () => pixels } } as ExtractableImageData);
    ModelTextures.getMeta = async () => undefined;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    const model: Model = {
        key: new AssetKey("test", "cube", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(name => [name, { texture: "#side", ...face }]))
        }]
    };
    Models.getMerged = async () => model;
    const atlas = (await UVMapper.getAtlas(model))!;
    const add = (variant: Partial<BlockStateVariant>, instanceMeshes = true) => scene.addBlock({
        variants: { "": { model: "test:block/cube", ...variant } }
    }, { applyDefaultState: false, instanceMeshes });
    return { scene, model, atlas, add };
}

function uvs(model: ModelObject): number[] {
    return Array.from((model.children[0] as Mesh).geometry.getAttribute("uv").array);
}

function faceUvs(model: ModelObject, face: CubeFace): number[] {
    const atlas = model.textureAtlas!;
    const uv = (model.children[0] as Mesh).geometry.getAttribute("uv");
    const [x, y] = atlas.positions.side;
    const [width, height] = atlas.sizes.side;
    const start = CUBE_FACES.indexOf(face) * 4;
    return Array.from({ length: 4 }, (_, i) => [
        (uv.getX(start + i) * atlas.image.width - x) * 16 / width,
        ((1 - uv.getY(start + i)) * atlas.image.height - y) * 16 / height
    ]).flat();
}

test.serial("locked quarter-turns keep full-face texture directions aligned for x, y, and combined rotations", async t => {
    const { scene, add } = await fixture(t);
    const cases = [
        { variant: { x: 90 }, face: CubeFace.EAST, expected: [0, 16, 0, 0, 16, 16, 16, 0] },
        { variant: { x: 180 }, face: CubeFace.EAST, expected: [16, 16, 0, 16, 16, 0, 0, 0] },
        { variant: { x: 270 }, face: CubeFace.EAST, expected: [16, 0, 16, 16, 0, 0, 0, 16] },
        { variant: { y: 90 }, face: CubeFace.UP, expected: [16, 0, 16, 16, 0, 0, 0, 16] },
        { variant: { y: 180 }, face: CubeFace.UP, expected: [16, 16, 0, 16, 16, 0, 0, 0] },
        { variant: { y: 270 }, face: CubeFace.UP, expected: [0, 16, 0, 0, 16, 16, 16, 0] },
        { variant: { x: 90, y: 90 }, face: CubeFace.SOUTH, expected: [0, 16, 0, 0, 16, 16, 16, 0] }
    ];
    for (const { variant, face, expected } of cases) {
        await add({ ...variant, uvlock: true }, false);
        t.deepEqual(faceUvs(scene.children[scene.children.length - 1] as ModelObject, face), expected);
    }
});

test.serial("UV locking transforms cropped coordinates after explicit face rotation", async t => {
    const { scene, add } = await fixture(t, { uv: [1, 2, 6, 9], rotation: 90 });
    const cases = [
        { variant: { x: 90 }, face: CubeFace.EAST, expected: [9, 15, 2, 15, 9, 10, 2, 10] },
        { variant: { x: 90 }, face: CubeFace.NORTH, expected: [15, 7, 15, 14, 10, 7, 10, 14] },
        { variant: { y: 90 }, face: CubeFace.UP, expected: [7, 1, 14, 1, 7, 6, 14, 6] },
        { variant: { x: 90, y: 90 }, face: CubeFace.SOUTH, expected: [9, 15, 2, 15, 9, 10, 2, 10] },
        { variant: { x: 90, y: 90 }, face: CubeFace.WEST, expected: [1, 9, 1, 2, 6, 9, 6, 2] }
    ];
    for (const { variant, face, expected } of cases) {
        await add({ ...variant, uvlock: true }, false);
        t.deepEqual(faceUvs(scene.children[scene.children.length - 1] as ModelObject, face), expected);
    }
});

test.serial("UV locking preserves the direction of reversed rectangle endpoints", async t => {
    const { scene, add } = await fixture(t, { uv: [14, 3, 4, 10], rotation: 90 });
    await add({ y: 90, uvlock: true }, false);
    t.deepEqual(faceUvs(scene.children[0] as ModelObject, CubeFace.UP), [6, 14, 13, 14, 6, 4, 13, 4]);
});

test.serial("locked UV configurations use separate instance pools and identical configurations share", async t => {
    const { scene, add } = await fixture(t);
    await add({ y: 90, uvlock: false });
    const unlocked = scene.children[0] as ModelObject;
    await add({ x: 90, uvlock: true });
    await add({ y: 90, uvlock: true });
    t.is(scene.children.length, 3);
    const lockedX = scene.children[1] as ModelObject;
    const lockedY = scene.children[2] as ModelObject;
    const meshes = [unlocked, lockedX, lockedY].map(model => model.children[0] as InstancedMesh);
    t.deepEqual(meshes.map(mesh => mesh.count), [1, 1, 1]);
    t.deepEqual(meshes.map(mesh => mesh.instanceMatrix.count), [50, 50, 50]);
    t.notDeepEqual(uvs(lockedX), uvs(unlocked));
    t.notDeepEqual(uvs(lockedY), uvs(unlocked));
    t.notDeepEqual(uvs(lockedX), uvs(lockedY));

    await add({ x: 90, uvlock: true });
    t.is(scene.children.length, 3);
    t.is(unlocked.instanceCounter, 1);
    t.is(lockedX.instanceCounter, 2);
    t.is(lockedY.instanceCounter, 1);
    t.deepEqual(meshes.map(mesh => mesh.count), [1, 2, 1]);
});

test.serial("UV locking preserves shared atlas data and leaves unlocked cropped face rotations unchanged", async t => {
    const { scene, model, atlas, add } = await fixture(t, { uv: [1, 2, 6, 9], rotation: 90 });
    const originalModel = JSON.stringify(model);
    const originalAtlas = JSON.stringify([atlas.positions, atlas.sizes]);
    const originalUvs = [...atlas.model.elements![0].mappedUv!];
    await add({ x: 90, y: 90, uvlock: false });
    const unlocked = scene.children[0] as ModelObject;
    t.deepEqual(uvs(unlocked), originalUvs);
    await add({ x: 90, y: 90, uvlock: true });
    const locked = scene.children[scene.children.length - 1] as ModelObject;
    t.notDeepEqual(uvs(locked), originalUvs);
    t.is(locked.textureAtlas, atlas);
    t.is(unlocked.textureAtlas, atlas);
    t.is(JSON.stringify(model), originalModel);
    t.is(JSON.stringify([atlas.positions, atlas.sizes]), originalAtlas);
    t.deepEqual(atlas.model.elements![0].mappedUv, originalUvs);
    t.deepEqual(uvs(unlocked), originalUvs);
});
