import test, { ExecutionContext } from "ava";
import { Box3, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { Entities } from "../src/assets/Entities";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import type { EntityModelPart } from "../src/entity/EntityModel";
import { Materials } from "../src/Materials";
import { DisplayPosition } from "../src/model/DisplayPosition";
import type { ItemModel, SpecialItemRenderer, TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { UVMapper } from "../src/UVMapper";

const coordinates = (v: Vector3) => v.toArray().map(value => Math.round(value * 1e6) / 1e6);
const part = (children: Record<string, EntityModelPart> = {}, origin?: TripleArray, size: TripleArray = [8, 8, 8]): EntityModelPart => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
    cubes: origin ? [{ origin, size, uv: [0, 0] }] : [], children
});

function fixture(t: ExecutionContext) {
    const originals = { entity: Entities.getEntity, texture: ModelTextures.get, image: Materials.getImage, atlas: UVMapper.getAtlas };
    const material = new MeshBasicMaterial();
    const requests: { key: BasicAssetKey, texture?: BasicAssetKey }[] = [];
    const textures: AssetKey[] = [];
    const objects: ModelObject[] = [];
    Caching.clear();
    Materials.getImage = () => material;
    UVMapper.getAtlas = async () => { throw new Error("Special items must not load a block-model atlas"); };
    ModelTextures.get = async key => { textures.push(key); return undefined; };
    Entities.getEntity = async (key, texture) => {
        requests.push({ key, texture });
        const id = key.path;
        const root = id === "chest" ? part({ bottom: part({}, [1, 0, 1], [14, 10, 14]), lid: part(), lock: part() })
            : id.startsWith("bed_") ? part({ main: part({}, [0, 0, 0], [16, 16, 6]) })
            : part({ head: part({ jaw: part(), left_ear: part(), right_ear: part() }, [-4, -8, -4]) });
        return { key, id, texture: texture as AssetKey | undefined, transform: [{ translate: [100, 200, 300] }], layer: { texture: [64, 64], root } };
    };
    t.teardown(() => {
        objects.forEach(object => object.dispose());
        Entities.getEntity = originals.entity;
        ModelTextures.get = originals.texture;
        Materials.getImage = originals.image;
        UVMapper.getAtlas = originals.atlas;
        material.dispose();
        Caching.clear();
    });
    const create = async (special: SpecialItemRenderer, display?: ItemModel["display"]) => {
        const model: ItemModel = {
            key: new AssetKey("custom", "fixture", "models", "item", "assets", ".json", "https://example.test/pack"), special, display
        };
        const object = await new MineRenderScene().addModel(model, { instanceMeshes: true, displayPosition: DisplayPosition.GUI });
        t.true(object instanceof ModelObject);
        objects.push(object as ModelObject);
        return object as ModelObject;
    };
    return { create, requests, textures, material };
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
