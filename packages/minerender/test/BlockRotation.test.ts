import test, { ExecutionContext } from "ava";
import { BoxGeometry, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { Models } from "../src/assets/Models";
import { ModelObject } from "../src/model/scene/ModelObject";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { InstanceReference } from "../src/instance/InstanceReference";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

function fixture(t: ExecutionContext, beforeInit: () => Promise<void> = async () => {}) {
    const originals = { get: Models.getMerged, init: ModelObject.prototype.init };
    const meshes: Mesh[] = [];
    Models.getMerged = async key => ({ key });
    ModelObject.prototype.init = async function () {
        await beforeInit();
        const geometry = new BoxGeometry(16, 16, 16);
        const material = new MeshBasicMaterial();
        const mesh = this.options.instanceMeshes
            ? this["createInstancedMesh"](undefined, geometry, material, this.options.maxInstanceCount)
            : new Mesh(geometry, material);
        this.add(mesh);
        this["_isInstanced"] = this.options.instanceMeshes;
        meshes.push(mesh);
    };
    t.teardown(() => {
        Models.getMerged = originals.get;
        ModelObject.prototype.init = originals.init;
        for (const mesh of meshes) {
            mesh.geometry.dispose();
            (mesh.material as MeshBasicMaterial).dispose();
        }
    });
    return { scene: new MineRenderScene() };
}

function hasRotation(matrix: Matrix4, rotation: Euler): boolean {
    const actual = new Quaternion();
    matrix.decompose(new Vector3(), actual, new Vector3());
    return actual.angleTo(new Quaternion().setFromEuler(rotation)) < 1e-6;
}

const xRotation = new Euler(Math.PI / 2, 0, 0);
const yRotation = new Euler(0, -Math.PI / 2, 0);

test.serial("concurrent blocks await shared model initialization before assigning distinct rotations", async t => {
    const started = deferred();
    const ready = deferred();
    const { scene } = fixture(t, async () => { started.resolve(); await ready.promise; });
    t.teardown(() => ready.resolve());
    let settled = 0;
    const first = scene.addBlock({ variants: { "": { model: "test:block/shared", x: 90 } } }, { applyDefaultState: false });
    const second = scene.addBlock({ variants: { "": { model: "test:block/shared", y: 90 } } }, { applyDefaultState: false });
    first.then(() => settled++);
    second.then(() => settled++);
    await started.promise;
    t.is(settled, 0);
    t.is(scene.children.length, 0);
    ready.resolve();
    await Promise.all([first, second]);

    t.is(scene.children.length, 1);
    const model = scene.children[0] as ModelObject;
    t.is(model.instanceCounter, 2);
    t.true(hasRotation(model.getMatrixAt(0), xRotation));
    t.true(hasRotation(model.getMatrixAt(1), yRotation));
});

test.serial("positioning multipart blocks preserves each shared model slot's rotation", async t => {
    const { scene } = fixture(t);
    const block = await scene.addBlock({ multipart: [
        { apply: { model: "test:block/shared", x: 90 } },
        { apply: { model: "test:block/shared", y: 90 } }
    ] }, { applyDefaultState: false }) as BlockObject;
    await scene.addBlock({ variants: { "": { model: "test:block/shared", x: 180 } } }, { applyDefaultState: false });
    const model = scene.children[0] as ModelObject;
    const untouched = model.getMatrixAt(2);
    const position = new Vector3(16, 32, 48);

    block.setPosition(position);

    t.true(hasRotation(model.getMatrixAt(0), xRotation));
    t.true(hasRotation(model.getMatrixAt(1), yRotation));
    for (const index of [0, 1]) {
        t.deepEqual(new Vector3().setFromMatrixPosition(model.getMatrixAt(index)), position);
    }
    t.deepEqual(model.getMatrixAt(2), untouched);
});

test.serial("multipart state changes and removal reuse slots without moving other blocks", async t => {
    const { scene } = fixture(t);
    const blockState = { multipart: [
        { apply: { model: "test:block/shared", y: 90 } },
        { when: { powered: "true" }, apply: { model: "test:block/shared", x: 90 } }
    ] };
    const options = { applyDefaultState: false, maxInstanceCount: 3 };
    const block = await scene.addBlock(blockState, options) as BlockObject;
    const other = await scene.addBlock({ variants: { "": { model: "test:block/shared", x: 180 } } }, options) as BlockObject;
    const model = scene.children[0] as ModelObject;
    const otherRef = other["_models"][0] as InstanceReference<ModelObject>;
    other.setPosition(new Vector3(-16, 0, 32));
    const untouched = otherRef.getMatrix();
    const position = new Vector3(16, 32, 48);
    block.setPosition(position);

    for (let i = 0; i < 8; i++) {
        const powered = i % 2 === 0;
        await block.setState("powered", `${powered}`);
        const refs = block["_models"] as InstanceReference<ModelObject>[];
        t.is(refs.length, powered ? 2 : 1);
        t.is(model.instanceCounter, refs.length + 1);
        t.is(scene.stats.instanceCount, refs.length + 1);
        t.is((model.children[0] as InstancedMesh).instanceMatrix.count, 3);
        for (const [part, ref] of refs.entries()) {
            t.deepEqual(ref.getPosition(), position);
            t.true(hasRotation(ref.getMatrix(), part === 0 ? yRotation : xRotation));
        }
        t.deepEqual(otherRef.getMatrix(), untouched);
    }

    block.removeFromScene();
    block.removeFromScene();
    block.dispose();
    t.is(block["_models"].length, 0);
    t.is(model.instanceCounter, 1);
    t.is(scene.stats.instanceCount, 1);
    t.deepEqual(otherRef.getMatrix(), untouched);

    const replacement = await scene.addBlock(blockState, options) as BlockObject;
    t.is((model.children[0] as InstancedMesh).instanceMatrix.count, 3);
    t.is(model.instanceCounter, 2);
    replacement.dispose();
    other.dispose();
    other.dispose();
    t.is(model.instanceCounter, 0);
    t.is(scene.stats.instanceCount, 0);
});

test.serial("non-instanced block state changes and disposal detach their owned models", async t => {
    const { scene } = fixture(t);
    const block = await scene.addBlock({ multipart: [
        { apply: { model: "test:block/shared", y: 90 } },
        { when: { powered: "true" }, apply: { model: "test:block/shared", x: 90 } }
    ] }, { applyDefaultState: false, instanceMeshes: false }) as BlockObject;
    const other = await scene.addBlock({ variants: { "": { model: "test:block/shared" } } }, {
        applyDefaultState: false, instanceMeshes: false
    }) as BlockObject;
    const oldModel = block["_models"][0] as ModelObject;
    const otherModel = other["_models"][0] as ModelObject;
    let atlasDisposals = 0;
    const sharedAtlas = { dispose: () => { atlasDisposals++; } } as NonNullable<ModelObject["textureAtlas"]>;
    oldModel["atlas"] = otherModel["atlas"] = sharedAtlas;
    const position = new Vector3(16, 32, 48);
    block.setPosition(position);

    await block.setState("powered", "true");

    t.is(oldModel.parent, null);
    t.is(oldModel.children.length, 0);
    t.is(atlasDisposals, 0);
    const models = [...block["_models"]] as ModelObject[];
    t.is(scene.children.length, 3);
    for (const [part, model] of models.entries()) {
        model["atlas"] = sharedAtlas;
        t.deepEqual(model.position, position);
        t.true(hasRotation(new Matrix4().makeRotationFromEuler(model.rotation), part === 0 ? yRotation : xRotation));
    }

    block.dispose();
    block.dispose();
    block.removeFromScene();
    t.is(block["_models"].length, 0);
    t.deepEqual(scene.children, [otherModel]);
    t.is(otherModel.textureAtlas, sharedAtlas);
    t.is(atlasDisposals, 0);
    for (const model of models) {
        t.is(model.parent, null);
        t.is(model.children.length, 0);
    }
    other.removeFromScene();
    t.is(scene.children.length, 0);
    t.is(atlasDisposals, 0);
});
