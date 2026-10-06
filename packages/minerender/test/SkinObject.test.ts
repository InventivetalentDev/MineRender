import test, { ExecutionContext } from "ava";
import { Box3, BufferGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { Caching } from "../src/cache/Caching";
import { Materials } from "../src/Materials";
import { SkinObject, SkinObjectOptions } from "../src/skin/scene/SkinObject";
import { SkinTextures } from "../src/skin/SkinTextures";

const arms = ["leftArm", "leftSleeve", "rightArm", "rightSleeve"];

function fixture(t: ExecutionContext) {
    const original = Materials.getImage;
    const originalTexture = SkinTextures.get;
    const material = new MeshBasicMaterial();
    const skins: SkinObject[] = [];
    Materials.getImage = () => material;
    SkinTextures.get = async () => ({ material, slim: false, legacy: false });
    Caching.clear();
    t.teardown(() => {
        Materials.getImage = original;
        SkinTextures.get = originalTexture;
        const geometries = new Set<BufferGeometry>();
        for (const skin of skins) skin.iterateAllMeshes(mesh => geometries.add(mesh.geometry));
        for (const geometry of geometries) geometry.dispose();
        material.dispose();
        Caching.clear();
    });
    return (options?: Partial<SkinObjectOptions>) => {
        const skin = new SkinObject(options);
        skins.push(skin);
        return skin;
    };
}

function facePixels(skin: SkinObject, part: string, face: number) {
    const uv = skin.getMeshByName(part)!.geometry.getAttribute("uv");
    const first = face * 4;
    return [0, 1, 2, 3].map(vertex => [uv.getX(first + vertex) * 64, (1 - uv.getY(first + vertex)) * 64]);
}

function texture(t: ExecutionContext, slim = false, legacy = false) {
    const material = new MeshBasicMaterial();
    t.teardown(() => material.dispose());
    return { material, slim, legacy };
}

const armWidth = (skin: SkinObject) => skin.getMeshByName("leftArm")!.geometry.boundingBox!.getSize(new Vector3()).x;

test.serial("slim selected before initialization uses three-unit arms and the slim skin texture regions", async t => {
    const create = fixture(t);
    const skin = create();
    skin.setSlim(true);
    t.is(skin.children.length, 0);
    await skin.init();
    t.is(skin.children.length, 6);
    t.is(skin.getGroupByName("leftArm")!.position.x, -5);
    t.is(skin.getGroupByName("rightArm")!.position.x, 5);
    for (const part of arms) {
        const size = skin.getMeshByName(part)!.geometry.boundingBox!.getSize(new Vector3());
        t.deepEqual(size.toArray().map(value => Math.round(value * 1000) / 1000),
            part.endsWith("Sleeve") ? [3.5, 12.5, 4.5] : [3, 12, 4]);
    }
    for (const [part, face, rectangle] of [
        ["leftArm", 5, [36, 52, 39, 64]],
        ["rightArm", 5, [44, 20, 47, 32]],
        ["leftSleeve", 5, [52, 52, 55, 64]],
        ["rightSleeve", 5, [44, 36, 47, 48]],
        ["leftArm", 1, [39, 52, 43, 64]],
        ["rightArm", 4, [51, 20, 54, 32]],
        ["leftSleeve", 2, [55, 52, 52, 48]],
        ["rightSleeve", 3, [50, 32, 47, 36]]
    ] as Array<[string, number, number[]]>) {
        const [x1, y1, x2, y2] = rectangle;
        t.deepEqual(facePixels(skin, part, face), [[x1, y1], [x2, y1], [x1, y2], [x2, y2]]);
    }
});

test.serial("skin bounds, posed joints and trouser end faces match the vanilla player model", async t => {
    const skin = fixture(t)();
    await skin.init();
    const bounds = (part: string) => {
        skin.updateMatrixWorld(true);
        const box = new Box3().setFromObject(skin.getMeshByName(part)!);
        return [box.min.toArray(), box.max.toArray()].map(point => point.map(value => Math.round(value * 1e6) / 1e6 || 0));
    };
    const expected = {
        head: [[-4, 24, -4], [4, 32, 4]],
        hat: [[-4.5, 23.5, -4.5], [4.5, 32.5, 4.5]],
        body: [[-4, 12, -2], [4, 24, 2]],
        jacket: [[-4.25, 11.75, -2.25], [4.25, 24.25, 2.25]],
        leftArm: [[-8, 12, -2], [-4, 24, 2]],
        rightArm: [[4, 12, -2], [8, 24, 2]],
        leftSleeve: [[-8.25, 11.75, -2.25], [-3.75, 24.25, 2.25]],
        rightSleeve: [[3.75, 11.75, -2.25], [8.25, 24.25, 2.25]],
        leftLeg: [[-3.9, 0, -2], [0.1, 12, 2]],
        rightLeg: [[-0.1, 0, -2], [3.9, 12, 2]],
        leftTrousers: [[-4.15, -0.25, -2.25], [0.35, 12.25, 2.25]],
        rightTrousers: [[-0.35, -0.25, -2.25], [4.15, 12.25, 2.25]]
    };
    for (const [part, box] of Object.entries(expected)) t.deepEqual(bounds(part), box, part);
    t.deepEqual(facePixels(skin, "rightTrousers", 2), [[8, 36], [4, 36], [8, 32], [4, 32]]);
    t.deepEqual(facePixels(skin, "rightTrousers", 3), [[12, 32], [8, 32], [12, 36], [8, 36]]);
    for (const part of ["body", "leftArm", "rightArm", "leftLeg"]) skin.getGroupByName(part)!.rotation.z = Math.PI / 2;
    t.deepEqual(bounds("body"), [[0, 20, -2], [12, 28, 2]]);
    t.deepEqual(bounds("leftArm"), [[-7, 19, -2], [5, 23, 2]]);
    t.deepEqual(bounds("rightArm"), [[3, 21, -2], [15, 25, 2]]);
    t.deepEqual(bounds("leftLeg"), [[-1.9, 10, -2], [10.1, 14, 2]]);
    skin.setSlim(true);
    t.deepEqual(bounds("leftArm"), [[-7, 20, -2], [5, 23, 2]]);
    t.deepEqual(bounds("rightArm"), [[3, 21, -2], [15, 24, 2]]);
});

test.serial("switching arm variants preserves the existing skin graph and caller state and only dirties changes", async t => {
    const skin = fixture(t)();
    await skin.init();
    await skin.setSkinTexture("fixture:skin");
    const left = skin.getGroupByName("leftArm")!;
    const right = skin.getGroupByName("rightArm")!;
    left.position.set(-7, 23, 1);
    right.position.set(9, 25, 3);
    left.rotation.set(0.2, 0.4, 0.6);
    right.scale.set(1, 2, 3);
    skin.getMeshByName("leftSleeve")!.visible = false;
    skin.getMeshByName("rightArm")!.rotation.z = 0.3;
    const customMaterial = new MeshBasicMaterial({ color: 0x123456 });
    skin.getMeshByName("rightArm")!.material = customMaterial;
    t.teardown(() => customMaterial.dispose());
    const nodes: Object3D[] = [];
    skin.traverse(node => nodes.push(node));
    const state = nodes.map(node => ({
        parent: node.parent, position: node.position.toArray(), rotation: node.rotation.toArray(),
        scale: node.scale.toArray(), visible: node.visible,
        material: (node as Mesh).material, geometry: (node as Mesh).geometry
    }));
    let changes = 0;
    skin.addEventListener("change", () => changes++);
    skin.setSlim(false);
    t.is(changes, 0);
    for (const slim of [true, false]) {
        skin.setSlim(slim);
        t.is(changes, slim ? 1 : 2);
        const current: Object3D[] = [];
        skin.traverse(node => current.push(node));
        t.true(current.length === nodes.length && current.every((node, index) => node === nodes[index]));
        nodes.forEach((node, index) => {
            const saved = state[index];
            const position = saved.position.slice();
            if (slim && ["mesh:leftArm", "mesh:leftSleeve"].includes(node.name)) position[0] += 0.5;
            if (slim && ["mesh:rightArm", "mesh:rightSleeve"].includes(node.name)) position[0] -= 0.5;
            t.deepEqual([node.parent, node.position.toArray(), node.rotation.toArray(), node.scale.toArray(), node.visible, (node as Mesh).material],
                [saved.parent, position, saved.rotation, saved.scale, saved.visible, saved.material]);
            if (!arms.includes(node.name.replace("mesh:", ""))) t.is((node as Mesh).geometry, saved.geometry);
        });
        t.is(skin.getGroupByName("leftArm"), left);
        t.is(skin.getGroupByName("rightArm"), right);
        skin.setSlim(slim);
        t.is(changes, slim ? 1 : 2);
    }
});

test.serial("switching skins reuses cached geometry without mutating or disposing another skin's resources", async t => {
    const create = fixture(t);
    const skin = create();
    const other = create();
    await skin.init();
    await other.init();
    let disposals = 0;
    const geometries = arms.map(part => other.getMeshByName(part)!.geometry);
    const attributes = geometries.map(geometry => [Array.from(geometry.getAttribute("position").array), Array.from(geometry.getAttribute("uv").array)]);
    geometries.forEach((geometry, index) => {
        t.is(skin.getMeshByName(arms[index])!.geometry, geometry);
        geometry.addEventListener("dispose", () => disposals++);
    });
    const material = other.getMeshByName("leftArm")!.material as MeshBasicMaterial;
    material.addEventListener("dispose", () => disposals++);
    skin.setSlim(true);
    const slimGeometry = skin.getMeshByName("leftArm")!.geometry;
    slimGeometry.addEventListener("dispose", () => disposals++);
    skin.setSlim(false);
    t.is(skin.getMeshByName("leftArm")!.geometry, geometries[0]);
    skin.setSlim(true);
    t.is(skin.getMeshByName("leftArm")!.geometry, slimGeometry);
    geometries.forEach((geometry, index) => {
        t.is(other.getMeshByName(arms[index])!.geometry, geometry);
        t.deepEqual([Array.from(geometry.getAttribute("position").array), Array.from(geometry.getAttribute("uv").array)], attributes[index]);
    });
    t.is(other.getMeshByName("leftArm")!.material, material);
    t.is(disposals, 0);
});

test.serial("loaded skins detect the model unless overridden and retain pre-init textures and existing parts", async t => {
    const create = fixture(t);
    const textures = { classic: texture(t), slim: texture(t, true), legacy: texture(t, false, true) };
    const calls: Array<[string, boolean | undefined]> = [];
    SkinTextures.get = async (src, legacy) => {
        calls.push([src, legacy]);
        const result = textures[src as keyof typeof textures];
        return { ...result, legacy: legacy ?? result.legacy, slim: legacy ? false : result.slim };
    };
    const skin = create();
    await skin.setSkinTexture("legacy");
    await skin.init();
    skin.iterateAllMeshes(mesh => t.is(mesh.material, textures.legacy.material));
    t.true(skin.getMeshByName("hat")!.visible);
    const parts = skin.children.flatMap(group => group.children);
    skin.getGroupByName("head")!.rotation.x = 0.4;
    skin.getMeshByName("jacket")!.visible = false;
    await skin.setSkinTexture("slim");
    t.is(armWidth(skin), 3);
    await skin.setSkinTexture("classic");
    t.is(armWidth(skin), 4);
    skin.setSlim(false);
    await skin.setSkinTexture("slim");
    t.is(armWidth(skin), 4);
    skin.setSlim(undefined);
    t.is(armWidth(skin), 3);
    await skin.setSkinTexture("classic");
    t.is(armWidth(skin), 4);
    skin.setSlim(true);
    await skin.setSkinTexture("classic");
    t.is(armWidth(skin), 3);
    skin.setSlim(undefined);
    t.is(armWidth(skin), 4);
    await skin.setLegacy(true);
    t.deepEqual(calls.at(-1), ["classic", true]);
    await skin.setLegacy(undefined);
    t.deepEqual(calls.at(-1), ["classic", undefined]);
    t.true(skin.getMeshByName("hat")!.visible);
    t.is(skin.getGroupByName("head")!.rotation.x, 0.4);
    t.false(skin.getMeshByName("jacket")!.visible);
    t.true(skin.children.flatMap(group => group.children).every((part, index) => part === parts[index]));
    const forced = create({ slim: true, legacy: true });
    await forced.setSkinTexture("classic");
    await forced.init();
    t.deepEqual(calls.at(-1), ["classic", true]);
    t.is(armWidth(forced), 3);
});

test.serial("pending loads respect current overrides, the latest request and disposal", async t => {
    const skin = fixture(t)();
    await skin.init();
    const classic = texture(t);
    const slim = texture(t, true);
    const legacy = texture(t, false, true);
    const pending: Array<{ src: string; legacy?: boolean; resolve: (result: typeof classic) => void }> = [];
    SkinTextures.get = (src, legacy) => new Promise(resolve => pending.push({ src, legacy, resolve }));
    let changes = 0;
    skin.addEventListener("change", () => changes++);
    const old = skin.setSkinTexture("old");
    const latest = skin.setSkinTexture("latest");
    skin.setSlim(false);
    t.is(changes, 0);
    pending[1].resolve(slim);
    await latest;
    t.is(armWidth(skin), 4);
    t.is(skin.getMeshByName("head")!.material, slim.material);
    t.true(changes > 0);
    const completedChanges = changes;
    pending[0].resolve(classic);
    await old;
    t.is(skin.getMeshByName("head")!.material, slim.material);
    t.is(changes, completedChanges);
    const next = skin.setSkinTexture("next");
    skin.setSlim(true);
    skin.setSlim(undefined);
    pending[2].resolve(classic);
    await next;
    t.is(armWidth(skin), 4);
    const original = skin.setSkinTexture("reprocess");
    const reprocessed = skin.setLegacy(true);
    t.deepEqual(pending.slice(3).map(({ src, legacy }) => [src, legacy]), [["reprocess", undefined], ["reprocess", true]]);
    pending[4].resolve(legacy);
    await reprocessed;
    pending[3].resolve(slim);
    await original;
    t.is(skin.getMeshByName("head")!.material, legacy.material);
    t.is(armWidth(skin), 4);
    const head = skin.getMeshByName("head")!;
    const disposed = skin.setSkinTexture("disposed");
    skin.dispose();
    const disposedChanges = changes;
    pending[5].resolve(classic);
    await disposed;
    t.is(skin.children.length, 0);
    t.is(head.material, legacy.material);
    t.is(changes, disposedChanges);
});

test.serial("failed loads reject without replacing the displayed skin and can be retried with a legacy override", async t => {
    const skin = fixture(t)();
    await skin.init();
    const loaded = texture(t, true);
    SkinTextures.get = async () => loaded;
    await skin.setSkinTexture("good");
    const geometry = skin.getMeshByName("leftArm")!.geometry;
    let changes = 0;
    skin.addEventListener("change", () => changes++);
    const error = new Error("skin decode failed");
    SkinTextures.get = async () => { throw error; };
    await t.throwsAsync(skin.setSkinTexture("broken"), { is: error });
    t.is(skin.getMeshByName("leftArm")!.geometry, geometry);
    t.is(skin.getMeshByName("head")!.material, loaded.material);
    t.is(changes, 0);
    SkinTextures.get = async (src, legacy) => {
        t.deepEqual([src, legacy], ["broken", false]);
        return loaded;
    };
    await skin.setLegacy(false);
    t.true(changes > 0);
});
