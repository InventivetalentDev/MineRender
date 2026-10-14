import test from "ava";
import { DoubleSide, FrontSide, InstancedMesh, Material, Mesh, MeshBasicMaterial, ShaderMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { Materials } from "../src/Materials";
import { ModelObject } from "../src/model/scene/ModelObject";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { Model } from "../src/model/Model";

test.serial("model materials blend only partial alpha and keep transparent atlases double-sided", async t => {
    const originals = { atlas: UVMapper.getAtlas, material: Materials.getImage };
    const placeholder = new MeshBasicMaterial();
    const objects: ModelObject[] = [];
    Caching.clear();
    Materials.getImage = () => placeholder;
    t.teardown(() => {
        for (const object of objects) object.dispose();
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        placeholder.dispose();
        Caching.clear();
    });
    const model: Model = {
        key: new AssetKey("test", "material_cube", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side" }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }]
    };
    for (const [hasTransparency, hasTranslucency] of [[false, false], [true, false], [true, true]]) {
        const atlas = new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage,
            { side: [16, 16] }, { side: [0, 0] }, false, {}, hasTransparency, hasTranslucency);
        UVMapper.getAtlas = async () => atlas;
        const object = new ModelObject(model, { instanceMeshes: false });
        objects.push(object);
        await object.init();

        const material = (object.children[0] as Mesh).material as Material;
        t.is(material.transparent, hasTranslucency);
        t.is(material.side, hasTransparency ? DoubleSide : FrontSide);
    }
});

test.serial("element shading survives separate, merged and instanced meshes without changing tints or cached geometry", async t => {
    const originals = { atlas: UVMapper.getAtlas, material: Materials.getImage };
    const placeholder = new MeshBasicMaterial();
    const objects: ModelObject[] = [];
    Caching.clear();
    Materials.getImage = () => placeholder;
    t.teardown(() => {
        for (const object of objects) object.dispose();
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        placeholder.dispose();
        Caching.clear();
    });
    const model: Model = {
        key: new AssetKey("test", "mixed_shading", "models", "block"),
        textures: { side: "block/stone" },
        elements: [false, true, undefined].map(shade => ({
            from: [0, 0, 0], to: [16, 16, 16], shade,
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", tintindex: 0 }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }))
    };
    const atlas = new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage,
        { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    UVMapper.getAtlas = async () => atlas;
    const base = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    const original = JSON.stringify(model);
    for (const options of [
        { mergeMeshes: false, instanceMeshes: false },
        { mergeMeshes: true, instanceMeshes: false },
        { mergeMeshes: true, instanceMeshes: true }
    ]) {
        const object = new ModelObject(model, { ...options, tints: { 0: 0xff0000 } });
        objects.push(object);
        await object.init();
        const meshes = object.children as Mesh[];
        t.is(meshes.length, options.mergeMeshes ? 1 : 3);
        for (const [index, mesh] of meshes.entries()) {
            const values = mesh.geometry.getAttribute("shade");
            const expected = options.mergeMeshes ? [0, 1, 1] : [index === 0 ? 0 : 1];
            t.deepEqual(Array.from(values?.array ?? []), expected.flatMap(value => Array(24).fill(value)));
            t.deepEqual(Array.from(mesh.geometry.getAttribute("color").array),
                Array.from({ length: mesh.geometry.getAttribute("position").count }, () => [1, 0, 0]).flat());
            t.is(mesh instanceof InstancedMesh, options.instanceMeshes);
            t.true((mesh.material as ShaderMaterial).uniforms.SHADE.value);
        }
    }
    t.false(base.hasAttribute("shade"));
    t.false(base.hasAttribute("color"));
    t.is(JSON.stringify(model), original);
});
