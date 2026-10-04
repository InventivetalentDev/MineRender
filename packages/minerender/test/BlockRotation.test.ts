import test, { ExecutionContext } from "ava";
import { BoxGeometry, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { Models } from "../src/assets/Models";
import { ModelObject } from "../src/model/scene/ModelObject";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";

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
            ? new InstancedMesh(geometry, material, this.options.maxInstanceCount)
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
