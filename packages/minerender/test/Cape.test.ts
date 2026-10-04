import test, { ExecutionContext } from "ava";
import { BufferGeometry, DataTexture, FrontSide, MeshBasicMaterial, NearestFilter, SRGBColorSpace, Vector3 } from "three";
import { Caching } from "../src/cache/Caching";
import { ImageLoader } from "../src/image/ImageLoader";
import { Materials } from "../src/Materials";
import { SkinTextures } from "../src/skin/SkinTextures";
import { SkinObject } from "../src/skin/scene/SkinObject";

function fixture(t: ExecutionContext) {
    const original = { image: Materials.getImage, data: ImageLoader.getData, skin: SkinTextures.get, cape: SkinTextures.getCape };
    const skins: SkinObject[] = [];
    const materials = new Set<MeshBasicMaterial>();
    const track = (material: MeshBasicMaterial) => { materials.add(material); return material; };
    const material = () => track(new MeshBasicMaterial());
    Materials.getImage = material;
    Caching.clear();
    t.teardown(() => {
        Materials.getImage = original.image;
        ImageLoader.getData = original.data;
        SkinTextures.get = original.skin;
        SkinTextures.getCape = original.cape;
        const geometries = new Set<BufferGeometry>();
        for (const skin of skins) skin.iterateAllMeshes(mesh => geometries.add(mesh.geometry));
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) { material.map?.dispose(); material.dispose(); }
        Caching.clear();
    });
    return { material, track, create: () => {
        const skin = new SkinObject();
        skins.push(skin);
        return skin;
    } };
}

function image(width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set([x, y, 73, (x + y) % 256], (y * width + x) * 4);
    }
    return { width, height, data, colorSpace: "srgb" } as ImageData;
}

test.serial("cape textures preserve pixels and alpha, cache separately from skins, and validate scaled vanilla layouts", async t => {
    const { track } = fixture(t);
    const sources = { cape: image(64, 32), scaled: image(128, 64), square: image(64, 64), fractional: image(96, 48) };
    const original = sources.cape.data.slice();
    const error = new Error("cape decode failed");
    ImageLoader.getData = async src => {
        if (src === "broken") throw error;
        return sources[src as keyof typeof sources];
    };
    for (const src of ["cape", "scaled"] as const) {
        const material = track(await SkinTextures.getCape(src));
        const map = material.map as DataTexture;
        t.deepEqual([map.image.width, map.image.height], [sources[src].width, sources[src].height]);
        t.deepEqual(map.image.data, new Uint8Array(sources[src].data));
        t.not(map.image.data, sources[src].data);
        t.deepEqual([map.colorSpace, map.flipY, map.magFilter, map.minFilter], [SRGBColorSpace, true, NearestFilter, NearestFilter]);
        t.deepEqual([material.transparent, material.side, material.alphaTest], [false, FrontSide, 0]);
        t.is(await SkinTextures.getCape(src), material);
    }
    const skin = track((await SkinTextures.get("cape")).material);
    t.not(await SkinTextures.getCape("cape"), skin);
    t.deepEqual(sources.cape.data, original);
    await t.throwsAsync(SkinTextures.getCape("square"), { message: /64x64/ });
    await t.throwsAsync(SkinTextures.getCape("fractional"), { message: /96x48/ });
    await t.throwsAsync(SkinTextures.getCape("broken"), { is: error });
});

test.serial("a cape loaded before initialization keeps its named mesh, vanilla UVs and shoulder placement", async t => {
    const { create, material } = fixture(t);
    const skin = create();
    const capeMaterial = material();
    SkinTextures.getCape = async () => capeMaterial;
    t.is(skin.getGroupByName("cape"), undefined);
    await skin.setCapeTexture("cape");
    const group = skin.getGroupByName("cape")!;
    const mesh = skin.getMeshByName("cape")!;
    await skin.init();
    t.is(skin.getGroupByName("cape"), group);
    t.is(skin.getMeshByName("cape"), mesh);
    t.is(skin.children.length, 7);
    t.is(mesh.parent, group);
    t.is(mesh.material, capeMaterial);
    t.deepEqual(mesh.geometry.boundingBox!.getSize(new Vector3()).toArray(), [10, 16, 1]);
    t.deepEqual(group.position.toArray(), [0, 24, 2]);
    t.true(Math.abs(group.rotation.x + Math.PI / 30) < 1e-12);
    t.deepEqual([group.rotation.y, group.rotation.z, group.rotation.order], [Math.PI, 0, "XYZ"]);
    t.deepEqual(mesh.position.toArray(), [0, -8, -0.5]);
    const uv = mesh.geometry.getAttribute("uv");
    for (const [face, [x1, y1, x2, y2]] of [
        [0, 1, 1, 17], [11, 1, 12, 17], [11, 1, 1, 0],
        [21, 0, 11, 1], [12, 1, 22, 17], [1, 1, 11, 17]
    ].entries()) {
        const pixels = [0, 1, 2, 3].map(vertex => [uv.getX(face * 4 + vertex) * 64, (1 - uv.getY(face * 4 + vertex)) * 32]);
        t.deepEqual(pixels, [[x1, y1], [x2, y1], [x1, y2], [x2, y2]]);
    }
    const round = (point: Vector3) => point.toArray().map(value => Math.round(value * 1e6) / 1e6);
    t.deepEqual(round(mesh.localToWorld(new Vector3(0, 8, 0.5))), [0, 24, 2]);
    t.deepEqual(round(mesh.localToWorld(new Vector3(0, -8, 0.5))),
        round(new Vector3(0, 24 - 16 * Math.cos(Math.PI / 30), 2 + 16 * Math.sin(Math.PI / 30))));
});

test.serial("cape replacement preserves poses and visibility while skin changes keep its material independent", async t => {
    const { create, material } = fixture(t);
    const skin = create();
    await skin.init();
    const first = material();
    const second = material();
    const body = material();
    SkinTextures.getCape = async src => src === "first" ? first : second;
    SkinTextures.get = async () => ({ material: body, slim: true, legacy: false });
    await skin.setCapeTexture("first");
    const group = skin.getGroupByName("cape")!;
    const mesh = skin.getMeshByName("cape")!;
    const geometry = mesh.geometry;
    group.rotation.x = -0.5;
    group.position.y = 23;
    mesh.rotation.z = 0.2;
    mesh.visible = false;
    let disposals = 0;
    first.addEventListener("dispose", () => disposals++);
    geometry.addEventListener("dispose", () => disposals++);
    let changes = 0;
    skin.addEventListener("change", () => changes++);
    await skin.setCapeTexture("second");
    t.true(changes > 0);
    t.is(skin.getGroupByName("cape"), group);
    t.is(skin.getMeshByName("cape"), mesh);
    t.is(mesh.geometry, geometry);
    t.deepEqual([group.rotation.x, group.position.y, mesh.rotation.z, mesh.visible], [-0.5, 23, 0.2, false]);
    t.is(mesh.material, second);
    await skin.setSkinTexture("skin");
    t.is(skin.getMeshByName("head")!.material, body);
    t.is(mesh.material, second);
    t.is(skin.children.length, 7);
    await skin.setCapeTexture(undefined);
    t.is(skin.getGroupByName("cape"), undefined);
    t.is(skin.getMeshByName("cape"), undefined);
    t.is(skin.children.length, 6);
    t.is(disposals, 0);
});

test.serial("cape loads remain independent, ignore stale results, retain failures and stop applying after removal or disposal", async t => {
    const { create, material } = fixture(t);
    const skin = create();
    await skin.init();
    const first = material();
    const second = material();
    const body = material();
    const pending: Array<{ resolve: (material: MeshBasicMaterial) => void; reject: (error: Error) => void }> = [];
    SkinTextures.getCape = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    SkinTextures.get = async () => ({ material: body, slim: false, legacy: false });
    const old = skin.setCapeTexture("old");
    const latest = skin.setCapeTexture("latest");
    await skin.setSkinTexture("skin");
    pending[1].resolve(second);
    await latest;
    pending[0].resolve(first);
    await old;
    t.is(skin.getMeshByName("cape")!.material, second);
    t.is(skin.getMeshByName("head")!.material, body);
    const failed = skin.setCapeTexture("failed");
    const error = new Error("cape load failed");
    pending[2].reject(error);
    await t.throwsAsync(failed, { is: error });
    t.is(skin.getMeshByName("cape")!.material, second);
    const removed = skin.setCapeTexture("removed");
    await skin.setCapeTexture(undefined);
    pending[3].resolve(first);
    await removed;
    t.is(skin.getMeshByName("cape"), undefined);
    const disposed = skin.setCapeTexture("disposed");
    skin.dispose();
    let changes = 0;
    skin.addEventListener("change", () => changes++);
    pending[4].resolve(first);
    await disposed;
    t.is(skin.children.length, 0);
    t.is(changes, 0);
});
