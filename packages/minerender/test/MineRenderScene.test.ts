import test from "ava";
import { BoxGeometry, MeshBasicMaterial, Object3D } from "three";
import { AssetContext } from "../src/assets/AssetContext";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelObject } from "../src/model/scene/ModelObject";
import { InstanceReference } from "../src/instance/InstanceReference";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { GuiObject } from "../src/gui/scene/GuiObject";
import { SkinObject } from "../src/skin/scene/SkinObject";
import { SceneObject } from "../src/renderer/SceneObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";

test("an added listener that throws leaves the attached object registered", t => {
    const scene = new MineRenderScene();
    const object = new Object3D();
    const error = new Error("added listener failed");
    object.addEventListener("added", () => { throw error; });

    t.throws(() => scene.add(object), { is: error });
    t.is(object.parent, scene);
    t.is(scene.stats.objectCount, 1);
    scene.dirty = false;
    object.dispatchEvent({ type: "change" });
    t.true(scene.dirty);

    scene.remove(object);
    t.is(scene.stats.objectCount, 0);
});


test.serial("preloaded models retain their context and use separate instance pools within one scene", async t => {
    const first = new AssetContext(), second = new AssetContext();
    const scene = new MineRenderScene({ assets: first });
    const key = AssetKey.parse("models", "test:block/shared");
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
    const init = ModelObject.prototype.init;
    ModelObject.prototype.init = async function () {
        this.add(this["createInstancedMesh"](undefined, geometry, material, 4));
    };
    t.teardown(() => {
        ModelObject.prototype.init = init;
        for (const object of scene.children) (object as ModelObject).dispose();
        geometry.dispose(); material.dispose();
    });
    const model = () => ({ key, elements: [], textures: {} });
    const a = await scene.addModel(first.bind(model())) as InstanceReference<ModelObject>;
    const b = await scene.addModel(second.bind(model())) as InstanceReference<ModelObject>;
    const repeated = await scene.addModel(second.bind(model())) as InstanceReference<ModelObject>;
    t.is(a.instanceable.assets, first);
    t.is(b.instanceable.assets, second);
    t.not(a.instanceable, b.instanceable);
    t.is(repeated.instanceable, b.instanceable);
    const overridden = second.bind(model());
    const explicit = await scene.addModel(overridden, { assets: first }) as InstanceReference<ModelObject>;
    t.is(explicit.instanceable, a.instanceable);
    t.is(AssetContext.origin(overridden), second);
    t.is(scene.children.length, 2);
});


test("initAndAdd preserves explicit and already captured object contexts", async t => {
    const assets = new AssetContext();
    const scene = new MineRenderScene({ assets: new AssetContext() });
    const explicit = new SceneObject({ assets }), captured = new SceneObject(), inherited = new SceneObject();
    const previous = captured.assets;
    t.is(AssetContext.for(explicit), assets);
    t.is(AssetContext.for(captured), previous);
    await scene.initAndAdd(explicit, captured, inherited);
    t.teardown(() => { for (const object of [explicit, captured, inherited]) object.dispose(); });
    t.is(explicit.assets, assets);
    t.is(AssetContext.for(explicit), assets);
    t.is(captured.assets, previous);
    t.is(AssetContext.for(captured), previous);
    t.is(inherited.assets, scene.assets);
    t.is(AssetContext.for(inherited), scene.assets);
});


test("unbound render objects inherit the scene assigned after construction", t => {
    const scene = new MineRenderScene({ assets: new AssetContext() });
    const objects = [new ModelObject({ elements: [] }), new BlockObject({ variants: {} }),
        new EntityObject({ id: "test:entity", key: new AssetKey("test", "entity"),
            layer: { texture: [16, 16], root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} } } }),
        new GuiObject([]), new SkinObject()];
    t.teardown(() => objects.forEach(object => object.dispose()));
    for (const object of objects) {
        t.is(AssetContext.origin(object), undefined);
        object.scene = scene;
        t.is(object.assets, scene.assets);
    }
});

test("explicit object options take precedence over provenance and the scene", t => {
    const origin = new AssetContext(), explicit = new AssetContext();
    const scene = new MineRenderScene({ assets: new AssetContext() });
    const model = origin.bind({ elements: [] });
    const state = origin.bind({ variants: {} });
    const entity = origin.bind({ id: "test:entity", key: new AssetKey("test", "entity"),
        layer: { texture: [16, 16] as [number, number], root: {
            pose: { offset: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, cubes: [], children: {} } } });
    const loaded = [new ModelObject(model, { assets: explicit }), new BlockObject(state, { assets: explicit }),
        new EntityObject(entity, { assets: explicit }), new GuiObject(origin.bind([]), { assets: explicit })];
    const supplied = [new ModelObject({ elements: [] }, { assets: explicit }), new BlockObject({ variants: {} }, { assets: explicit }),
        new EntityObject({ ...entity }, { assets: explicit }), new GuiObject([], { assets: explicit }), new SkinObject({ assets: explicit })];
    t.teardown(() => [...loaded, ...supplied].forEach(object => object.dispose()));
    for (const object of [...loaded, ...supplied]) object.scene = scene;
    t.true(loaded.every(object => object.assets === explicit && object.options.assets === explicit));
    t.true(supplied.every(object => object.assets === explicit && object.options.assets === explicit));
    t.is(AssetContext.origin(model), origin);
    t.is(AssetContext.origin(state), origin);
});


test.serial("scene add methods honor explicit assets without rebinding the supplied data", async t => {
    const origin = new AssetContext(), explicit = new AssetContext();
    const scene = new MineRenderScene({ assets: new AssetContext() });
    for (const prototype of [ModelObject.prototype, BlockObject.prototype, EntityObject.prototype, GuiObject.prototype]) {
        const init = prototype.init;
        prototype.init = async () => {};
        t.teardown(() => { prototype.init = init; });
    }
    const model = origin.bind({ elements: [] });
    const state = origin.bind({ variants: {} });
    const entity = origin.bind({ id: "test:entity", key: new AssetKey("test", "entity"),
        layer: { texture: [16, 16] as [number, number], root: {
            pose: { offset: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, cubes: [], children: {} } } });
    const layers = origin.bind([]);
    const options = { assets: explicit, instanceMeshes: false };
    const objects = await Promise.all([scene.addModel(model, options), scene.addBlock(state, options),
        scene.addEntity(entity, options), scene.addGui(layers, options)]);
    t.teardown(() => objects.forEach(object => object.dispose()));
    for (const object of objects as SceneObject[]) {
        t.is(object.assets, explicit);
        t.is(AssetContext.origin(object), explicit);
    }
    for (const value of [model, state, entity, layers]) t.is(AssetContext.origin(value), origin);
});
