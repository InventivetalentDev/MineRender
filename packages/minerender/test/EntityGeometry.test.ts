import test, { ExecutionContext } from "ava";
import { Box3, Euler, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { Materials } from "../src/Materials";
import { EntityObject, EntityObjectOptions } from "../src/entity/scene/EntityObject";
import type { EntityLayer, EntityModelCube, EntityModelPart } from "../src/entity/EntityModel";
import type { DoubleArray } from "../src/model/Model";

const cube: EntityModelCube = { origin: [1, 2, 3], size: [2, 3, 4], uv: [5, 6] };
const part = (options: Partial<EntityModelPart> = {}): EntityModelPart => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {}, ...options
});
const coordinates = (vector: Vector3) => vector.toArray().map(value => Math.round(value * 1e6) / 1e6);

function fixture(t: ExecutionContext) {
    const original = Materials.getImage;
    const material = new MeshBasicMaterial();
    const objects: EntityObject[] = [];
    Materials.getImage = () => material;
    Caching.clear();
    t.teardown(() => {
        Materials.getImage = original;
        for (const object of objects) object.iterateAllMeshes(mesh => mesh.geometry.dispose());
        material.dispose();
        Caching.clear();
    });
    return (root: EntityModelPart, texture: DoubleArray = [64, 32], options?: Partial<EntityObjectOptions>, layers?: Record<string, EntityLayer>) => {
        const object = new EntityObject({ key: new BasicAssetKey("minecraft", "fixture"), id: "minecraft:fixture", layer: { texture, root }, layers }, options);
        object["createMeshes"]();
        objects.push(object);
        return object;
    };
}

function uvs(object: EntityObject, name: string): number[] {
    return Array.from(object.getMeshByName(name)!.geometry.getAttribute("uv").array);
}

const vanillaUvs = [
    [15, 13], [11, 13], [15, 10], [11, 10],
    [9, 13], [5, 13], [9, 10], [5, 10],
    [11, 10], [13, 10], [11, 6], [13, 6],
    [9, 6], [11, 6], [9, 10], [11, 10],
    [17, 13], [15, 13], [17, 10], [15, 10],
    [11, 13], [9, 13], [11, 10], [9, 10]
];
const normalized = (pixels: number[][], width = 64, height = 32) => pixels.flatMap(([u, v]) => [u / width, 1 - v / height]);

test.serial("nested parts compose local radian poses before the entity coordinate conversion and caller transforms", t => {
    const create = fixture(t);
    const model = part({
        pose: { offset: [2, 3, 4], rotation: [0, 0, Math.PI / 2], scale: [2, 1, 1] },
        children: { arm: part({
            pose: { offset: [3, 1, 2], rotation: [Math.PI / 2, Math.PI / 2, 0] }, cubes: [cube],
            children: { hand: part({ pose: { offset: [1, 2, 3], rotation: [0, 0, 0] }, cubes: [cube] }) }
        }) }
    });
    const object = create(model);
    const root = object.getGroupByName("root")!;
    const arm = object.getGroupByName("arm")!;
    const hand = object.getGroupByName("hand")!;
    t.is(arm.parent, root);
    t.is(hand.parent, arm);
    t.deepEqual(coordinates(arm.getWorldPosition(new Vector3())), [-1, -9, 6]);
    t.deepEqual(coordinates(hand.getWorldPosition(new Vector3())), [-4, -13, 5]);
    const meshes: Mesh[] = [];
    object.iterateAllMeshes(mesh => meshes.push(mesh));
    t.deepEqual(meshes.map(mesh => mesh.name), ["mesh:arm", "mesh:hand"]);

    object.setPositionRotationScale(new Vector3(10, 20, 30), new Euler(0, 0, Math.PI / 2), new Vector3(2, 3, 4));
    t.deepEqual(coordinates(hand.getWorldPosition(new Vector3())), [49, 12, 50]);
    t.deepEqual(object.scale.toArray(), [2, 3, 4]);
    t.is(root.parent, object.getLayerGroup("main"));
    t.deepEqual(root.parent!.parent!.scale.toArray(), [-1, -1, 1]);

    const unflipped = create(model, [64, 32], { flip: false });
    t.deepEqual(unflipped.getLayerGroup("main")!.parent!.scale.toArray(), [1, 1, 1]);
    t.deepEqual(coordinates(unflipped.getGroupByName("hand")!.getWorldPosition(new Vector3())), [4, 13, 5]);
});

test.serial("cube growth preserves vanilla UV dimensions and mirrored cubes swap side faces and reverse U", t => {
    const create = fixture(t);
    const object = create(part({ children: {
        plain: part({ cubes: [cube] }),
        grown: part({ cubes: [{ ...cube, grow: [0.5, 1, 1.5] }] }),
        mirrored: part({ cubes: [{ ...cube, mirror: true }] }),
        offset: part({ cubes: [{ ...cube, uv: [7, 9] }] })
    } }));
    const grown = object.getMeshByName("grown")!.geometry;
    grown.computeBoundingBox();
    t.deepEqual(coordinates(grown.boundingBox!.min), [0.5, 1, 1.5]);
    t.deepEqual(coordinates(grown.boundingBox!.max), [3.5, 6, 8.5]);
    t.deepEqual(uvs(object, "plain"), normalized(vanillaUvs));
    t.deepEqual(uvs(object, "grown"), normalized(vanillaUvs));
    t.deepEqual(uvs(object, "offset"), normalized(vanillaUvs.map(([u, v]) => [u + 2, v + 3])));
    t.deepEqual(uvs(object, "mirrored"), normalized([
        [5, 13], [9, 13], [5, 10], [9, 10],
        [11, 13], [15, 13], [11, 10], [15, 10],
        [13, 10], [11, 10], [13, 6], [11, 6],
        [11, 6], [9, 6], [11, 10], [9, 10],
        [15, 13], [17, 13], [15, 10], [17, 10],
        [9, 13], [11, 13], [9, 10], [11, 10]
    ]));
    t.deepEqual(Array.from(object.getMeshByName("mirrored")!.geometry.getAttribute("position").array),
        Array.from(object.getMeshByName("plain")!.geometry.getAttribute("position").array));
});

test.serial("texture dimensions inherit within each part subtree without leaking to siblings", t => {
    const create = fixture(t);
    const object = create(part({ children: {
        large: part({ texture: [128, 64], cubes: [cube], children: {
            inherited: part({ cubes: [cube] }),
            small: part({ texture: [32, 16], cubes: [cube] })
        } }),
        sibling: part({ cubes: [cube] }),
        untextured: part({ texture: [0, 0], cubes: [cube] })
    } }));
    t.deepEqual(uvs(object, "large"), normalized(vanillaUvs, 128, 64));
    t.deepEqual(uvs(object, "inherited"), normalized(vanillaUvs, 128, 64));
    t.deepEqual(uvs(object, "small"), normalized(vanillaUvs, 32, 16));
    t.deepEqual(uvs(object, "sibling"), normalized(vanillaUvs));
    t.deepEqual(uvs(object, "untextured"), new Array(48).fill(0));
});

test.serial("entity layers keep independent textures, UVs and poses under one shared coordinate conversion", async t => {
    const create = fixture(t);
    const root = part({ children: { head: part({
        pose: { offset: [3, 4, 5], rotation: [0, 0, 0] }, cubes: [cube]
    }) } });
    const main: EntityLayer = {
        key: new BasicAssetKey("custom", "fixture"), texture: AssetKey.parse("textures", "custom:entity/base"),
        layer: { texture: [64, 32], root }
    };
    const wool: EntityLayer = {
        ...main, texture: AssetKey.parse("textures", "custom:entity/overlay"), layer: { texture: [128, 64], root }
    };
    const originalGet = ModelTextures.get;
    const originalMaterial = Materials.createBasicCanvasMaterial;
    const canvases = [{}, {}] as HTMLCanvasElement[];
    const materials = [new MeshBasicMaterial({ color: 0xff0000 }), new MeshBasicMaterial({ color: 0x0000ff })];
    const requested: string[] = [];
    ModelTextures.get = async key => {
        requested.push(key.getFullPath());
        return { width: 1, height: 1, data: { canvas: canvases[key === main.texture ? 0 : 1] } as CanvasRenderingContext2D };
    };
    Materials.createBasicCanvasMaterial = canvas => materials[canvases.indexOf(canvas)];
    t.teardown(() => {
        ModelTextures.get = originalGet;
        Materials.createBasicCanvasMaterial = originalMaterial;
        materials.forEach(material => material.dispose());
    });
    const layers = { main, wool };
    const snapshot = JSON.stringify(layers);
    const object = create(root, [64, 32], undefined, layers);
    await object.init();
    const base = object.getMeshByName("head", "main")!;
    const overlay = object.getMeshByName("head", "wool")!;
    t.not(base, overlay);
    t.is(object.getMeshByName("head"), base);
    t.is(object.getGroupByName("head"), object.getGroupByName("head", "main"));
    t.is(object.getMeshByName("head", "missing"), undefined);
    t.is(object.getLayerGroup("main")!.parent, object.getLayerGroup("wool")!.parent);
    t.deepEqual([base.material, overlay.material], materials);
    t.deepEqual(requested, ["entity/base", "entity/overlay"]);
    t.deepEqual([base.renderOrder, overlay.renderOrder], [0, 1]);
    t.deepEqual(Array.from(base.geometry.getAttribute("uv").array), normalized(vanillaUvs));
    t.deepEqual(Array.from(overlay.geometry.getAttribute("uv").array), normalized(vanillaUvs, 128, 64));
    object.getGroupByName("head", "wool")!.rotation.z = Math.PI / 2;
    object.getLayerGroup("wool")!.visible = false;
    object.setPosition(new Vector3(10, 20, 30));
    object.updateMatrixWorld(true);
    t.deepEqual(coordinates(new Box3().setFromObject(base).getCenter(new Vector3())), [5, 12.5, 40]);
    t.deepEqual(coordinates(new Box3().setFromObject(overlay).getCenter(new Vector3())), [10.5, 14, 40]);
    t.true(object.getLayerGroup("main")!.visible);
    t.is(object.getGroupByName("head", "main")!.rotation.z, 0);
    const other = create(root, [64, 32], undefined, layers);
    await other.init();
    t.is(other.getMeshByName("head", "main")!.material, base.material);
    t.is(other.getMeshByName("head", "wool")!.material, overlay.material);
    t.is(requested.length, 2);
    t.is(JSON.stringify(layers), snapshot);
    const legacy = create(root);
    legacy.entity.key = AssetKey.parse("entities", "custom:boat/oak");
    await legacy.init();
    t.is(requested.at(-1), "entity/boat/oak");
});
