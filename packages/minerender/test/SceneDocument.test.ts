import test, { ExecutionContext } from "ava";
import { Group, Matrix4, MeshBasicMaterial, Object3D } from "three";
import { AssetContext } from "../src/assets/AssetContext";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { BlockEntities } from "../src/assets/BlockEntities";
import { BlockStates } from "../src/assets/BlockStates";
import { Entities } from "../src/assets/Entities";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { Materials } from "../src/Materials";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { SceneDocument, SceneObjectDefinition, SceneSkinDefinition } from "../src/scene/SceneDocument";
import { SceneDocumentLoader } from "../src/scene/SceneDocumentLoader";
import { SkinTextures } from "../src/skin/SkinTextures";

function document(objects: SceneObjectDefinition[] = []): SceneDocument {
    return { format: "minerender-scene", version: 1, objects };
}

function stub<T extends object, K extends keyof T>(t: ExecutionContext, target: T, key: K, value: T[K]): void {
    const original = target[key];
    target[key] = value;
    t.teardown(() => { target[key] = original; });
}

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

test("scene documents round-trip portable options and copy the caller's data", t => {
    const input = document([
        { id: "player", type: "skin", skin: "data:image/png;base64,AA==", hiddenParts: ["hat", "leftSleeve"], options: { slim: true }, pose: { head: [0.2, -0.4, 0], cape: [0, 0.3, 0] } },
        { id: "block", type: "block", asset: "minecraft:oak_stairs", state: { facing: "east" }, position: [16, 0, 0] },
        { id: "item", type: "item", asset: "minecraft:diamond", options: { tints: { 0: 0xff0000 } } },
        { id: "entity", type: "entity", asset: "minecraft:bat", layers: ["main"], animation: { name: "flying", paused: true, speed: 2 } },
        { id: "gui", type: "gui", layers: [{ text: [{ text: "Hello", color: 0xff0000 }], position: [0, 9] }, { item: "minecraft:item/diamond" }] }
    ]);
    input.camera = { position: [60, 40, 60], target: [0, 16, 0] };
    const parsed = SceneDocumentLoader.parse(JSON.stringify(input));
    t.deepEqual(parsed, input);
    const copy = SceneDocumentLoader.parse(input);
    copy.objects[1].position![0] = 64;
    t.is(input.objects[1].position![0], 16);
});

test("scene validation reports the malformed field before requesting assets", t => {
    const cases: [unknown, RegExp][] = [
        ["{", /invalid JSON/],
        [{ ...document(), version: 2 }, /scene.version/],
        [document([{ id: "same", type: "skin" }, { id: "same", type: "skin" }]), /objects\[1\].id: duplicate/],
        [document([{ id: "bad", type: "skin", position: [0, NaN, 0] }]), /position\[1\]/],
        [document([{ id: "bad", type: "skin", hiddenParts: ["missing"] }]), /hiddenParts\[0\]/],
        [document([{ id: "bad", type: "skin", pose: { head: [0, Infinity, 0] } }]), /pose.head\[1\]/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", pose: { hat: [0, 0, 0] } }] }, /pose.hat/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", pose: { unknown: [0, 0, 0] } }] }, /pose.unknown/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", pose: { body: [0, 0] } }] }, /pose.body/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", pose: { leftArm: new Array(3) } }] }, /pose.leftArm\[0\]/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", pose: [] }] }, /pose/],
        [document([{ id: "bad", type: "block", asset: "../secret" }]), /asset/],
        [document([{ id: "bad", type: "entity", asset: "pig", animation: { name: "walk", speed: -1 } }]), /animation.speed/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", options: { instanceMeshes: true } }] }, /options.instanceMeshes/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", options: { wireframe: true } }] }, /options.wireframe/],
        [{ ...document(), objects: [{ id: "bad", type: "gui", layers: [], options: { wireframe: true } }] }, /objects\[0\].options/],
        [{ ...document(), objects: [{ id: "bad", type: "gui", layers: [{ text: "hello", texture: "minecraft:gui/a" }] }] }, /exactly one/],
        [{ ...document(), objects: [{ id: "bad", type: "skin", position: new Array(3) }] }, /position\[0\]/],
        [JSON.parse('{"format":"minerender-scene","version":1,"objects":[],"__proto__":{}}'), /unsupported property/]
    ];
    for (const [input, message] of cases) t.throws(() => SceneDocumentLoader.parse(input), { message });
});

function modelFixture(t: ExecutionContext) {
    const created: ModelObject[] = [];
    const disposed: ModelObject[] = [];
    const originalDispose = ModelObject.prototype.dispose;
    stub(t, Models.prototype, "getMerged", async key => ({ key, elements: [], textures: {} }));
    stub(t, ModelObject.prototype, "init", async function () {
        created.push(this);
        this.add(new Object3D());
    });
    stub(t, ModelObject.prototype, "dispose", function () {
        disposed.push(this);
        originalDispose.call(this);
    });
    return { created, disposed };
}

test.serial("multipart blocks retain variant rotations under the document transform and later state changes", async t => {
    const { created, disposed } = modelFixture(t);
    stub(t, BlockEntities.prototype, "getIndex", async () => ({}));
    stub(t, BlockStates.prototype, "getDefaultState", async () => undefined);
    stub(t, BlockStates.prototype, "get", async key => ({ key, multipart: [
        { apply: { model: "minecraft:block/first", y: 90 } },
        { when: { open: "true" }, apply: { model: "minecraft:block/second", x: 90 } }
    ] }));
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.loadObject(scene, {
        id: "multipart", type: "block", asset: "minecraft:fixture", state: { open: "true" },
        position: [16, 8, -16], rotation: [0, Math.PI / 4, 0], scale: [2, 2, 2]
    });
    t.teardown(() => loaded.dispose());
    t.deepEqual(scene.children, [loaded.root]);
    t.is(created.length, 2);
    t.true(created.every(object => object.options.instanceMeshes === false && object.parent?.parent === loaded.root));
    t.not(created[0].rotation.y, 0);
    t.not(created[1].rotation.x, 0);
    scene.updateMatrixWorld(true);
    const expected = new Matrix4().multiplyMatrices(loaded.root.matrixWorld, created[0].matrix);
    t.deepEqual(created[0].matrixWorld.elements, expected.elements);

    scene.dirty = false;
    await (loaded.object as BlockObject).setState({ open: "false" });
    t.true(scene.dirty);
    t.deepEqual(scene.children, [loaded.root]);
    t.is(created.length, 3);
    t.is(created[2].parent?.parent, loaded.root);
    t.deepEqual(disposed, created.slice(0, 2));

    loaded.dispose();
    loaded.dispose();
    t.deepEqual(scene.children, []);
    t.deepEqual(disposed, created);
});

test.serial("documents load objects in parallel and preserve document order when they finish out of order", async t => {
    const { created, disposed } = modelFixture(t);
    const scene = new MineRenderScene();
    const existing = new Group();
    scene.add(existing);
    const names = ["first", "second", "third"];
    const gates = Object.fromEntries(names.map(name => [name, gate()]));
    const started: string[] = [];
    stub(t, Models.prototype, "getMerged", async key => {
        started.push(key.path);
        await gates[key.path].promise;
        return { key, elements: [], textures: {} };
    });
    const pending = SceneDocumentLoader.load(scene, document(names.map(id => ({ id, type: "model", asset: `minecraft:block/${id}` }))));
    t.deepEqual(started, names);
    gates.third.release();
    await new Promise(resolve => setImmediate(resolve));
    t.deepEqual(created.map(object => object.originalModel.key!.path), ["third"]);
    gates.second.release();
    await new Promise(resolve => setImmediate(resolve));
    t.deepEqual(created.map(object => object.originalModel.key!.path), ["third", "second"]);
    t.deepEqual(scene.children, [existing]);
    gates.first.release();
    const loaded = await pending;
    t.teardown(() => loaded.dispose());
    t.deepEqual(loaded.objects.map(object => object.definition.id), names);
    t.deepEqual(loaded.root.children.map(object => object.userData.sceneObjectId), names);
    t.deepEqual(scene.children, [existing, loaded.root]);
    loaded.dispose();
    t.deepEqual(scene.children, [existing]);
    t.is(disposed.length, created.length);
    t.true(created.every(object => disposed.includes(object) && object.parent === null));
});

test.serial("failed parallel documents wait for every load, dispose successes, and report the first error in document order", async t => {
    const { created, disposed } = modelFixture(t);
    const scene = new MineRenderScene();
    const existing = new Group();
    scene.add(existing);
    const names = ["first-failure", "early-success", "later-failure", "late-success"];
    const gates = Object.fromEntries(names.map(name => [name, gate()]));
    const started: string[] = [];
    stub(t, Models.prototype, "getMerged", async key => {
        started.push(key.path);
        await gates[key.path].promise;
        if (key.path.endsWith("failure")) throw new Error(`${key.path} download failed`);
        return { key, elements: [], textures: {} };
    });
    let settled = false;
    const pending = SceneDocumentLoader.load(scene, document(names.map(id => ({ id, type: "model", asset: `minecraft:block/${id}` }))));
    pending.then(() => { settled = true; }, () => { settled = true; });
    t.deepEqual(started, names);
    gates["early-success"].release();
    gates["later-failure"].release();
    await new Promise(resolve => setImmediate(resolve));
    t.deepEqual(created.map(object => object.originalModel.key!.path), ["early-success"]);
    t.false(settled);
    t.deepEqual(disposed, []);
    t.deepEqual(scene.children, [existing]);
    gates["first-failure"].release();
    await new Promise(resolve => setImmediate(resolve));
    t.false(settled);
    t.deepEqual(disposed, []);
    gates["late-success"].release();
    await t.throwsAsync(pending, { message: /Scene object "first-failure": first-failure download failed/ });
    t.deepEqual(created.map(object => object.originalModel.key!.path), ["early-success", "late-success"]);
    t.deepEqual(scene.children, [existing]);
    t.deepEqual(disposed, created);
    t.true(created.every(object => object.parent === null && object.children.length === 0));
});

test.serial("object init failures release the partially initialized model", async t => {
    const { created, disposed } = modelFixture(t);
    stub(t, ModelObject.prototype, "init", async function () {
        created.push(this);
        this.add(new Object3D());
        throw new Error("geometry failed");
    });
    const scene = new MineRenderScene();
    await t.throwsAsync(SceneDocumentLoader.loadObject(scene, { id: "broken", type: "model", asset: "minecraft:block/stone" }), { message: /geometry failed/ });
    t.deepEqual(disposed, created);
    t.deepEqual(created[0].children, []);
    t.deepEqual(scene.children, []);
});

test.serial("short item IDs select item models and GUI display without changing the configured version", async t => {
    const { created } = modelFixture(t);
    const scene = new MineRenderScene();
    stub(t, AssetLoader, "ROOT", "https://assets.mcasset.cloud/1.21.11");
    const originalRoot = AssetLoader.ROOT;
    const loaded = await SceneDocumentLoader.load(scene, document([
        { id: "short", type: "item", asset: "minecraft:diamond" },
        { id: "full", type: "item", asset: "minecraft:item/diamond" }
    ]));
    t.teardown(() => loaded.dispose());
    t.deepEqual(created.map(object => object.originalModel.key!.toNamespacedString()), ["minecraft:item/diamond", "minecraft:item/diamond"]);
    t.true(created.every(object => object.options.displayPosition === "gui"));
    await t.throwsAsync(SceneDocumentLoader.load(scene, { ...document(), minecraftVersion: "different-version" }), { message: /configure the scene asset context/ });
    t.is(AssetLoader.ROOT, originalRoot);
    t.deepEqual(scene.children, [loaded.root]);
});

test.serial("entity animations load by name, start at saved time, and respect pause and disposal", async t => {
    const material = new MeshBasicMaterial();
    stub(t, Materials, "getImage", () => material);
    Caching.clear();
    t.teardown(() => { material.dispose(); Caching.clear(); });
    const key = new AssetKey("minecraft", "fixture");
    stub(t, Entities.prototype, "getEntity", async () => ({ id: "minecraft:fixture", key,
        layer: { texture: [16, 16], root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} } }
    }));
    stub(t, EntityObject.prototype, "init", async function () { this["createMeshes"](); });
    stub(t, Entities.prototype, "getAnimations", async () => ({ walk: { length: 4, loop: true, bones: {} } }));
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.loadObject(scene, {
        id: "animated", type: "entity", asset: "minecraft:fixture", animation: { name: "walk", time: 1, speed: 2, paused: true }
    });
    t.teardown(() => loaded.dispose());
    const entity = loaded.object as EntityObject;
    loaded.advanceAnimation(0.25);
    t.is(entity.animationTime, 1);
    if (loaded.definition.type === "entity") loaded.definition.animation!.paused = false;
    scene.dirty = false;
    loaded.advanceAnimation(0.25);
    t.is(entity.animationTime, 1.5);
    t.true(scene.dirty);
    loaded.dispose();
    loaded.advanceAnimation(1);
    t.is(entity.animation, undefined);
    t.deepEqual(entity.children, []);
});

test.serial("embedded skin and cape textures stay portable and base parts hide independently of overlays", async t => {
    const material = new MeshBasicMaterial();
    let materialDisposed = false;
    material.addEventListener("dispose", () => { materialDisposed = true; });
    t.teardown(() => { material.dispose(); Caching.clear(); });
    const texture = "data:image/png;base64,AA==";
    stub(t, SkinTextures, "get", async source => {
        t.is(source, texture);
        return { material, slim: false, legacy: false };
    });
    stub(t, SkinTextures, "getCape", async (source, layout) => {
        t.is(source, texture);
        t.is(layout, "optifine");
        return material;
    });
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.loadObject(scene, {
        id: "player", type: "skin", skin: texture, cape: { texture, layout: "optifine" }, hiddenParts: ["head", "leftSleeve", "cape"]
    });
    t.teardown(() => loaded.dispose());
    for (const name of ["head", "leftSleeve", "cape"]) t.false(loaded.object.getMeshByName(name)!.visible);
    for (const name of ["hat", "leftArm", "body"]) t.true(loaded.object.getMeshByName(name)!.visible);
    loaded.dispose();
    t.false(materialDisposed);
    t.deepEqual(scene.children, []);
});

test.serial("players without a skin source use the active version's Steve or Alex texture", async t => {
    const material = new MeshBasicMaterial();
    t.teardown(() => { material.dispose(); Caching.clear(); });
    stub(t, AssetLoader, "ROOT", "https://assets.example.test/1.21.11");
    const sources: string[] = [];
    stub(t, SkinTextures, "get", async source => {
        sources.push(source);
        return { material, slim: source.includes("slim/alex"), legacy: false };
    });
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.load(scene, document([
        { id: "steve", type: "skin" }, { id: "alex", type: "skin", options: { slim: true } }
    ]));
    t.teardown(() => loaded.dispose());
    t.deepEqual(sources, [
        "https://assets.example.test/1.21.11/assets/minecraft/textures/entity/player/wide/steve.png",
        "https://assets.example.test/1.21.11/assets/minecraft/textures/entity/player/slim/alex.png"
    ]);
    t.true(loaded.objects.every(object => object.object.getMeshByName("head")!.material === material));
});

test.serial("saved skin poses rotate actual joint groups and their overlays for classic, slim, and legacy skins", async t => {
    const material = new MeshBasicMaterial();
    t.teardown(() => { material.dispose(); Caching.clear(); });
    const texture = "data:image/png;base64,AA==";
    const layouts: (boolean | undefined)[] = [];
    stub(t, SkinTextures, "get", async (source, legacy) => {
        t.is(source, texture);
        layouts.push(legacy);
        return { material, slim: false, legacy: legacy ?? false };
    });
    const pose: SceneSkinDefinition["pose"] = {
        head: [0.2, -0.4, 0.1], body: [0.3, 0.2, 0], leftArm: [-1.2, 0.1, 0.2],
        rightArm: [0.5, 0, -0.1], leftLeg: [0.4, 0.2, 0], rightLeg: [-0.4, -0.2, 0]
    };
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.load(scene, document([
        { id: "classic", type: "skin", skin: texture, pose },
        { id: "slim", type: "skin", skin: texture, pose, options: { slim: true } },
        { id: "legacy", type: "skin", skin: texture, pose, options: { legacy: true } }
    ]));
    t.teardown(() => loaded.dispose());
    t.deepEqual(layouts, [undefined, undefined, true]);
    scene.updateMatrixWorld(true);
    for (const loadedObject of loaded.objects) {
        for (const [name, rotation] of Object.entries(pose)) {
            const group = loadedObject.object.getGroupByName(name)!;
            t.deepEqual(group.rotation.toArray(), [...rotation, "XYZ"]);
        }
        for (const [part, overlay] of [["head", "hat"], ["body", "jacket"], ["leftArm", "leftSleeve"],
            ["rightArm", "rightSleeve"], ["leftLeg", "leftTrousers"], ["rightLeg", "rightTrousers"]]) {
            const group = loadedObject.object.getGroupByName(part)!;
            const mesh = loadedObject.object.getMeshByName(overlay)!;
            t.is(loadedObject.object.getMeshByName(part)!.parent, group);
            t.is(mesh.parent, group);
            t.deepEqual(mesh.matrixWorld.elements, new Matrix4().multiplyMatrices(group.matrixWorld, mesh.matrix).elements);
        }
    }
    const armWidths = loaded.objects.map(object => {
        const mesh = object.object.getMeshByName("leftArm")!;
        mesh.geometry.computeBoundingBox();
        return mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x;
    });
    t.deepEqual(armWidths, [4, 3, 4]);
});

test.serial("cape poses override the built-in angle and survive a saved scene without a cape texture", async t => {
    const material = new MeshBasicMaterial();
    t.teardown(() => { material.dispose(); Caching.clear(); });
    const texture = "data:image/png;base64,AA==";
    stub(t, SkinTextures, "get", async () => ({ material, slim: false, legacy: false }));
    stub(t, SkinTextures, "getCape", async () => material);
    const scene = new MineRenderScene();
    const loaded = await SceneDocumentLoader.load(scene, document([
        { id: "default", type: "skin", skin: texture, cape: { texture } },
        { id: "posed", type: "skin", skin: texture, cape: { texture }, pose: { body: [0.2, 0.3, 0], cape: [-0.4, 0.1, 0.2] } },
        { id: "saved", type: "skin", skin: texture, pose: { cape: [0, 0, 0] } }
    ]));
    t.teardown(() => loaded.dispose());
    t.deepEqual(loaded.objects[0].object.getGroupByName("cape")!.rotation.toArray(), [Math.PI / 30, 0, 0, "XYZ"]);
    const posed = loaded.objects[1].object;
    t.deepEqual(posed.getGroupByName("cape")!.rotation.toArray(), [-0.4, 0.1, 0.2, "XYZ"]);
    t.is(posed.getGroupByName("cape")!.parent, posed.getGroupByName("body"));
    const saved = loaded.objects[2];
    t.is(saved.object.getGroupByName("cape"), undefined);
    const definition = saved.definition as SceneSkinDefinition;
    t.deepEqual(definition.pose, { cape: [0, 0, 0] });
    const restored = await SceneDocumentLoader.loadObject(scene, { ...definition, cape: { texture } });
    t.teardown(() => restored.dispose());
    t.deepEqual(restored.object.getGroupByName("cape")!.rotation.toArray(), [0, 0, 0, "XYZ"]);
    t.deepEqual(restored.object.getGroupByName("head")!.rotation.toArray(), [0, 0, 0, "XYZ"]);
});


test.serial("documents use their scene version and context for nested objects and default skins", async t => {
    modelFixture(t);
    const assets = new AssetContext({ version: "document-version", root: "https://assets.example.test/document-version" });
    const scene = new MineRenderScene({ assets });
    const globalRoot = AssetLoader.ROOT;
    const material = new MeshBasicMaterial();
    t.teardown(() => material.dispose());
    stub(t, Models.prototype, "getMerged", async function(key) {
        t.is(this, assets.models);
        return { key, elements: [], textures: {} };
    });
    stub(t, SkinTextures, "get", async source => {
        t.is(source, `${assets.root}/assets/minecraft/textures/entity/player/wide/steve.png`);
        return { material, slim: false, legacy: false };
    });
    const loaded = await SceneDocumentLoader.load(scene, {
        ...document([{ id: "model", type: "model", asset: "test:block/stone" }, { id: "skin", type: "skin" },
            { id: "gui", type: "gui", layers: [] }]), minecraftVersion: assets.version
    });
    t.teardown(() => loaded.dispose());
    for (const { object } of loaded.objects) {
        t.is(object.assets, assets);
        t.is(object.scene.assets, assets);
    }
    t.is(AssetLoader.ROOT, globalRoot);
});
