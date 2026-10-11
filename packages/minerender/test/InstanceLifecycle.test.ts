import test, { ExecutionContext } from "ava";
import { BoxGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, Quaternion, StreamDrawUsage, Vector3 } from "three";
import { MineRenderError } from "../src/error/MineRenderError";
import { InstanceManager } from "../src/instance/InstanceManager";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { SceneObject } from "../src/renderer/SceneObject";

class Instances extends SceneObject {
    readonly mesh: InstancedMesh;

    constructor(capacity: number, geometry: BoxGeometry, material: MeshBasicMaterial) {
        super({ maxInstanceCount: capacity });
        this.scene = new MineRenderScene();
        this.add(new Object3D());
        this.mesh = this.createInstancedMesh("fixture", geometry, material, capacity);
        this.add(this.mesh);
        this._isInstanced = true;
        this.scene.add(this);
    }
}

function fixture(t: ExecutionContext, capacity = 2) {
    const geometry = new BoxGeometry(2, 2, 2);
    const material = new MeshBasicMaterial();
    const owner = new Instances(capacity, geometry, material);
    t.teardown(() => { owner.dispose(); geometry.dispose(); material.dispose(); });
    return owner;
}

const matrixValues = (matrix: Matrix4) => matrix.elements.map(value => Math.round(value * 1e6) / 1e6);
const slotMatrix = (mesh: InstancedMesh, index: number) => { const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix); return matrix; };

test("released slots are reused without moving live instances and stale references cannot control replacements", t => {
    const owner = fixture(t, 4);
    const [first, middle, last] = [owner.nextInstance(), owner.nextInstance(), owner.nextInstance()];
    t.is(owner.getInstanceReference(owner.mesh, middle.index), middle);
    t.is(owner.getInstanceReference(owner.children[0], middle.index), undefined);
    first.setPosition(new Vector3(10, 20, 30));
    last.setPosition(new Vector3(40, 50, 60));
    owner.mesh.setColorAt(middle.index, new Color(0xff0000));
    owner.scene.dirty = false;
    middle.removeFromScene();
    middle.dispose();
    t.is(owner.getInstanceReference(owner.mesh, middle.index), undefined);
    t.true(owner.scene.dirty);
    t.deepEqual([owner.instanceCounter, owner.scene.stats.instanceCount, owner.mesh.count], [2, 2, 3]);
    t.deepEqual(new Vector3().setFromMatrixScale(slotMatrix(owner.mesh, middle.index)).toArray(), [0, 0, 0]);
    const staleOperations = [
        () => middle.getMatrix(), () => middle.getPosition(), () => middle.getRotation(), () => middle.getScale(),
        () => middle.setMatrix(new Matrix4()), () => middle.setPosition(new Vector3()),
        () => middle.setRotation(new Euler()), () => middle.setScale(new Vector3(1, 1, 1)),
        () => middle.setPositionRotationScale(new Vector3(), new Euler(), new Vector3(1, 1, 1)),
        () => middle.setVisible(false), () => middle.setVisible(true)
    ];
    for (const operation of staleOperations) t.throws(operation, { instanceOf: MineRenderError });
    const replacement = owner.nextInstance();
    t.is(replacement.index, middle.index);
    t.is(owner.mesh.instanceMatrix.count, 4);
    t.deepEqual(replacement.getMatrix(), new Matrix4());
    const color = new Color();
    owner.mesh.getColorAt(replacement.index, color);
    t.deepEqual(color.toArray(), [1, 1, 1]);
    t.false(owner.isInstanceActive(middle.index, middle));
    t.true(owner.isInstanceActive(replacement.index, replacement));
    for (const operation of staleOperations) t.throws(operation, { instanceOf: MineRenderError });
    middle.removeFromScene();
    t.is(owner.instanceCounter, 3);
    t.deepEqual(first.getPosition().toArray(), [10, 20, 30]);
    t.deepEqual(last.getPosition().toArray(), [40, 50, 60]);
    last.dispose();
    t.is(owner.mesh.count, 2);
    owner.removeInstanceAt(replacement.index);
    owner.removeInstanceAt(replacement.index);
    t.deepEqual([owner.instanceCounter, owner.scene.stats.instanceCount, owner.mesh.count], [1, 1, 1]);
    first.dispose();
    t.deepEqual([owner.instanceCounter, owner.scene.stats.instanceCount, owner.mesh.count], [0, 0, 0]);
});

test("hidden instances retain transforms and restore without changing their siblings", t => {
    const owner = fixture(t);
    const [hidden, sibling] = [owner.nextInstance(), owner.nextInstance()];
    const position = new Vector3(10, 20, 30);
    const rotation = new Euler(0, 0.4, 0);
    const scale = new Vector3(2, 3, 4);
    hidden.setPositionRotationScale(position, rotation, scale);
    sibling.setPosition(new Vector3(40, 50, 60));
    const original = hidden.getMatrix();
    const siblingMatrix = sibling.getMatrix();
    owner.mesh.computeBoundingBox();
    owner.mesh.computeBoundingSphere();
    owner.scene.dirty = false;
    hidden.setVisible(false);
    hidden.setVisible(false);
    t.true(owner.scene.dirty);
    t.is(owner.mesh.boundingBox, null);
    t.is(owner.mesh.boundingSphere, null);
    t.deepEqual(hidden.getMatrix(), original);
    t.is(slotMatrix(owner.mesh, hidden.index).determinant(), 0);
    t.deepEqual([owner.instanceCounter, owner.scene.stats.instanceCount, owner.mesh.count], [2, 2, 2]);
    position.set(100, 200, 300);
    hidden.setPosition(position);
    const expected = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
    t.deepEqual(matrixValues(hidden.getMatrix()), matrixValues(expected));
    t.is(slotMatrix(owner.mesh, hidden.index).determinant(), 0);
    t.deepEqual(sibling.getMatrix(), siblingMatrix);
    owner.mesh.computeBoundingBox();
    owner.mesh.computeBoundingSphere();
    owner.scene.dirty = false;
    hidden.setVisible(true);
    hidden.setVisible(true);
    t.true(owner.scene.dirty);
    t.is(owner.mesh.boundingBox, null);
    t.is(owner.mesh.boundingSphere, null);
    t.deepEqual(matrixValues(slotMatrix(owner.mesh, hidden.index)), matrixValues(expected));
    t.deepEqual(sibling.getMatrix(), siblingMatrix);
    hidden.setVisible(false);
    hidden.dispose();
    const replacement = owner.nextInstance();
    t.is(replacement.index, hidden.index);
    t.deepEqual(slotMatrix(owner.mesh, replacement.index), new Matrix4());
    t.deepEqual(replacement.getMatrix(), new Matrix4());
    t.throws(() => hidden.setVisible(true), { instanceOf: MineRenderError });
});

test("bulk transforms skip holes and invalidate bounds when a live instance moves", t => {
    const owner = fixture(t, 3);
    const [first, hole, last] = [owner.nextInstance(), owner.nextInstance(), owner.nextInstance()];
    hole.dispose();
    const position = new Vector3(10, 20, 30);
    const rotation = new Euler(0, 0.4, 0);
    const scale = new Vector3(2, 3, 4);
    for (const transform of [
        () => owner.setPosition(position), () => owner.setRotation(rotation), () => owner.setScale(scale),
        () => owner.setPositionRotationScale(position, rotation, scale)
    ]) {
        owner.mesh.computeBoundingBox();
        owner.mesh.computeBoundingSphere();
        owner.scene.dirty = false;
        transform();
        t.true(owner.scene.dirty);
        t.is(owner.mesh.boundingBox, null);
        t.is(owner.mesh.boundingSphere, null);
        t.deepEqual(new Vector3().setFromMatrixScale(slotMatrix(owner.mesh, hole.index)).toArray(), [0, 0, 0]);
    }
    const expected = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
    t.deepEqual(matrixValues(first.getMatrix()), matrixValues(expected));
    t.deepEqual(matrixValues(last.getMatrix()), matrixValues(expected));
    t.true(Math.abs(first.getRotation().y - rotation.y) < 1e-6);
    owner.mesh.computeBoundingBox();
    owner.mesh.computeBoundingSphere();
    owner.scene.dirty = false;
    owner.setMatrixAt(last.index, new Matrix4().makeTranslation(1000, 0, 0));
    t.true(owner.scene.dirty);
    t.is(owner.mesh.boundingBox, null);
    t.is(owner.mesh.boundingSphere, null);
    owner.mesh.computeBoundingBox();
    t.true(owner.mesh.boundingBox!.containsPoint(new Vector3(1000, 0, 0)));
});

test("capacity growth preserves the mesh and live data while disposing only owned instance buffers", t => {
    const owner = fixture(t);
    const mesh = owner.mesh;
    const first = owner.nextInstance();
    const second = owner.nextInstance();
    first.setPositionRotationScale(new Vector3(1, 2, 3), new Euler(0.2, 0.4, 0.6), new Vector3(2, 2, 2));
    second.setPosition(new Vector3(4, 5, 6));
    const matrices = [first.getMatrix(), second.getMatrix()];
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.setColorAt(first.index, new Color(0xff0000));
    mesh.setColorAt(second.index, new Color(0x00ff00));
    mesh.instanceColor!.setUsage(StreamDrawUsage);
    const previous = { matrix: mesh.instanceMatrix, color: mesh.instanceColor, geometry: mesh.geometry, material: mesh.material };
    const child = new Object3D();
    mesh.add(child);
    mesh.position.set(7, 8, 9);
    mesh.rotation.set(0.1, 0.2, 0.3);
    mesh.scale.set(2, 3, 4);
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.userData = { marker: "retained" };
    const transform = [mesh.position.toArray(), mesh.rotation.toArray(), mesh.scale.toArray()];
    const disposedBuffers: unknown[] = [];
    let sharedDisposals = 0;
    let ownerDisposals = 0;
    owner.addEventListener("dispose", () => ownerDisposals++);
    mesh.addEventListener("dispose", () => disposedBuffers.push([mesh.instanceMatrix, mesh.instanceColor]));
    mesh.geometry.addEventListener("dispose", () => sharedDisposals++);
    (mesh.material as MeshBasicMaterial).addEventListener("dispose", () => sharedDisposals++);
    const third = owner.nextInstance();
    t.is(owner.mesh, mesh);
    t.is(owner.children[1], mesh);
    t.is(mesh.geometry, previous.geometry);
    t.is(mesh.material, previous.material);
    t.deepEqual(mesh.children, [child]);
    t.deepEqual([mesh.position.toArray(), mesh.rotation.toArray(), mesh.scale.toArray()], transform);
    t.deepEqual([mesh.visible, mesh.castShadow, mesh.frustumCulled, mesh.renderOrder, mesh.userData], [false, true, false, 8, { marker: "retained" }]);
    t.is(mesh.instanceMatrix.count, 4);
    t.is(mesh.instanceColor!.count, 4);
    t.deepEqual([mesh.instanceMatrix.usage, mesh.instanceColor!.usage], [DynamicDrawUsage, StreamDrawUsage]);
    t.deepEqual(disposedBuffers, [[previous.matrix, previous.color]]);
    t.deepEqual([first.getMatrix(), second.getMatrix()], matrices);
    t.deepEqual(third.getMatrix(), new Matrix4());
    const colors = [first, second, third].map(ref => { const color = new Color(); mesh.getColorAt(ref.index, color); return color.toArray(); });
    t.deepEqual(colors, [[1, 0, 0], [0, 1, 0], [1, 1, 1]]);
    t.is(sharedDisposals, 0);
    owner.dispose();
    t.is(ownerDisposals, 1);
    t.is(disposedBuffers.length, 2);
    t.is(sharedDisposals, 0);
    t.deepEqual([owner.instanceCounter, owner.scene.stats.instanceCount, mesh.count], [0, 0, 0]);
    for (const ref of [first, second, third]) t.throws(() => ref.getMatrix(), { instanceOf: MineRenderError });
    t.throws(() => owner.nextInstance(), { instanceOf: MineRenderError });
});

test("the manager shares pending creation, allocates after its first reference is removed and retries failed creation", async t => {
    const owner = fixture(t);
    const manager = new InstanceManager();
    let resolve!: (owner: Instances) => void;
    const ready = new Promise<Instances>(yes => { resolve = yes; });
    let creations = 0;
    const supplier = () => { creations++; return ready; };
    const pending = [manager.getOrCreate("shared", supplier), manager.getOrCreate("shared", supplier)];
    resolve(owner);
    const [first, second] = await Promise.all(pending);
    t.is(creations, 1);
    t.is(first.instanceable, second.instanceable);
    t.not(first.index, second.index);
    first.dispose();
    const replacement = await manager.getOrCreate("shared", supplier);
    t.is(creations, 1);
    t.is(replacement.index, first.index);
    t.true(owner.isInstanceActive(second.index, second));
    const error = new Error("model creation failed");
    await t.throwsAsync(manager.getOrCreate("retry", async () => { throw error; }), { is: error });
    t.is((await manager.getOrCreate("retry", () => owner)).instanceable, owner);
});
