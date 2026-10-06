import test, { ExecutionContext } from "ava";
import { Box3, Group, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { GuiHelper } from "../src/gui/GuiHelper";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { TextureAsset } from "../src/model/Model";

function fixture(t: ExecutionContext) {
    const get = ModelTextures.get;
    const scene = new MineRenderScene();
    const requests: AssetKey[] = [];
    const canvas = { width: 64, height: 32 };
    ModelTextures.get = async key => {
        requests.push(key);
        if (key.path === "missing") return undefined;
        Caching.textureAssetCache.get(key.serialize(), async () => ({ key } as TextureAsset));
        return { width: 64, height: 32, data: { canvas } } as unknown as ExtractableImageData;
    };
    Caching.clear();
    t.teardown(() => {
        ModelTextures.get = get;
        for (const object of [...scene.children]) {
            if ("dispose" in object) (object as { dispose(): void }).dispose();
            object.removeFromParent();
        }
        Caching.clear();
    });
    return { scene, requests };
}

test.serial("GUI crops and pixel layout preserve shared textures and caller input", async t => {
    const { scene, requests } = fixture(t);
    const texture = new AssetKey("test", "container", "textures", "gui", "assets", ".png", "test-root");
    const layers = [
        { name: "background", texture, crop: [8, 4, 16, 8] as [number, number, number, number],
            position: [-10, 4] as [number, number], size: [32, 16] as [number, number] },
        { name: "overlay", texture, crop: [32, 0, 8, 12] as [number, number, number, number],
            position: [30, -6] as [number, number] }
    ];
    const original = JSON.stringify(layers);
    const gui = await scene.addGui(layers);
    const background = gui.getMeshByName("background")!, overlay = gui.getMeshByName("overlay")!;
    const bounds = new Box3().setFromObject(background);
    t.deepEqual([bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y], [-10, -20, 22, -4]);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[-10, -6], [38, 20]]);
    t.is(background.material, overlay.material);
    t.not(background.geometry, overlay.geometry);
    t.deepEqual((background.material as MeshBasicMaterial).map!.offset.toArray(), [0, 0]);
    t.deepEqual((background.material as MeshBasicMaterial).map!.repeat.toArray(), [1, 1]);
    const uv = Array.from(background.geometry.getAttribute("uv").array);
    t.deepEqual(uv, [0.125, 0.875, 0.375, 0.875, 0.125, 0.625, 0.375, 0.625]);
    await scene.addGui([{ texture, crop: [0, 0, 4, 4] }]);
    t.deepEqual(Array.from(background.geometry.getAttribute("uv").array), uv);
    t.is(JSON.stringify(layers), original);
    t.true(requests.every(key => key.serialize() === texture.serialize()));
});

test.serial("GUI layers keep painter order and dispose geometry without releasing cached materials", async t => {
    const { scene, requests } = fixture(t);
    const parent = new Group();
    scene.add(parent);
    const gui = await scene.addGui([
        { name: "first", texture: "test:gui/container" },
        { name: "last", texture: "test:gui/container", size: [8, 8] }
    ], undefined, parent);
    t.is(gui.parent, parent);
    t.false(gui.isInstanced);
    scene.dirty = false;
    gui.setPosition(new Vector3(10, 20, 0));
    t.true(scene.dirty);
    scene.dirty = false;
    gui.toggleMeshVisibility("last", false);
    t.true(scene.dirty);
    const first = gui.getMeshByName("first")!, last = gui.getMeshByName("last")!;
    t.true(first.renderOrder < last.renderOrder);
    const material = first.material as MeshBasicMaterial;
    t.true(material.isMeshBasicMaterial);
    t.true(material.transparent);
    t.is(material.alphaTest, 0);
    t.false(material.depthWrite);
    t.true(material.depthTest);
    t.is(requests[0].toNamespacedString(), "test:gui/container");
    let geometryDisposals = 0, sharedDisposals = 0;
    for (const mesh of [first, last]) mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
    material.addEventListener("dispose", () => sharedDisposals++);
    material.map!.addEventListener("dispose", () => sharedDisposals++);
    scene.dirty = false;
    gui.dispose();
    t.true(scene.dirty);
    gui.dispose();
    t.is(geometryDisposals, 2);
    t.is(sharedDisposals, 0);
    t.is(gui.children.length, 0);
    scene.dirty = false;
    gui.removeFromScene();
    t.is(gui.parent, null);
    t.true(scene.dirty);
    const before = [...scene.children];
    const dispose = PlaneGeometry.prototype.dispose;
    let failedGeometryDisposals = 0;
    PlaneGeometry.prototype.dispose = function () { failedGeometryDisposals++; dispose.call(this); };
    try {
        await t.throwsAsync(scene.addGui([{ texture: "test:gui/container" }, { texture: "test:gui/missing" }]));
    } finally {
        PlaneGeometry.prototype.dispose = dispose;
    }
    t.is(failedGeometryDisposals, 1);
    t.deepEqual(scene.children, before);

    const get = ModelTextures.get;
    ModelTextures.get = async key => {
        const image = await get(key);
        Caching.clear();
        return image;
    };
    const key = AssetKey.parse("textures", "test:gui/uncached");
    const uncached = await scene.addGui([{ name: "owned", texture: key }]);
    ModelTextures.get = get;
    const owned = uncached.getMeshByName("owned")!.material as MeshBasicMaterial;
    t.is(Caching.materialCache.getIfPresent(`gui:${key.serialize()}`), undefined);
    let materialDisposals = 0, textureDisposals = 0;
    owned.addEventListener("dispose", () => materialDisposals++);
    owned.map!.addEventListener("dispose", () => textureDisposals++);
    uncached.dispose(); uncached.dispose();
    t.deepEqual([materialDisposals, textureDisposals, sharedDisposals], [1, 1, 0]);
});

test("inventory slots map indices and column-row coordinates to pixel positions", t => {
    for (const [slot, expected] of [[0, [0, 0]], [8, [144, 0]], [9, [0, 18]], [17, [144, 18]]] as const) {
        t.deepEqual(GuiHelper.inventorySlot(slot), [...expected]);
    }
    t.deepEqual(GuiHelper.inventorySlot([2, 3], [7, 11], [20, 24]), [47, 83]);
    t.deepEqual(GuiHelper.inventorySlot(7, [7, 11], [20, 24], 4), [67, 35]);
});
