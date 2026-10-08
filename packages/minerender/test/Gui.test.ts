import test, { ExecutionContext } from "ava";
import { Box3, Group, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import { AssetContext } from "../src/assets/AssetContext";
import { AssetLoader } from "../src/assets/AssetLoader";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { GuiObject } from "../src/gui/scene/GuiObject";
import { GuiHelper } from "../src/gui/GuiHelper";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { TextureAsset } from "../src/model/Model";

function fixture(t: ExecutionContext) {
    const get = ModelTextures.prototype.get;
    const getMeta = ModelTextures.prototype.getMeta;
    ModelTextures.prototype.getMeta = async () => undefined;
    const scene = new MineRenderScene();
    const requests: AssetKey[] = [];
    const canvas = { width: 64, height: 32 };
    ModelTextures.prototype.get = async key => {
        requests.push(key);
        if (key.path === "missing") return undefined;
        Caching.textureAssetCache.get(AssetLoader.context.cacheKey(key), async () => ({ key } as TextureAsset));
        return { width: 64, height: 32, data: { canvas } } as unknown as ExtractableImageData;
    };
    Caching.clear();
    t.teardown(() => {
        ModelTextures.prototype.get = get;
        ModelTextures.prototype.getMeta = getMeta;
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

test.serial("GUI sprite metadata sets logical size and scaling while explicit crops bypass it", async t => {
    const { scene } = fixture(t);
    const texture = new AssetKey("test", "sprites/panel", "textures", "gui", "assets", ".png", "test-root");
    const metadataRequests: AssetKey[] = [];
    ModelTextures.prototype.getMeta = async key => {
        metadataRequests.push(key);
        return { gui: { scaling: { type: "tile", width: 8, height: 4 } } };
    };
    const gui = await scene.addGui([
        { name: "native", texture },
        { name: "tiled", texture, size: [19, 9] },
        { name: "cropped", texture, crop: [8, 4, 16, 8], size: [32, 16] }
    ]);
    const native = gui.getMeshByName("native")!, tiled = gui.getMeshByName("tiled")!, cropped = gui.getMeshByName("cropped")!;
    const bounds = new Box3().setFromObject(native);
    t.deepEqual([bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y], [0, -4, 8, 0]);
    t.is(tiled.geometry.getAttribute("position").count, 36);
    t.deepEqual(Array.from(cropped.geometry.getAttribute("uv").array),
        [0.125, 0.875, 0.375, 0.875, 0.125, 0.625, 0.375, 0.625]);
    t.deepEqual(metadataRequests, [texture, texture]);
    t.is(native.material, tiled.material);
    t.is(tiled.material, cropped.material);
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

    const get = ModelTextures.prototype.get;
    ModelTextures.prototype.get = async function(key) {
        const image = await get.call(this, key);
        Caching.clear();
        return image;
    };
    const key = AssetKey.parse("textures", "test:gui/uncached");
    const uncached = await scene.addGui([{ name: "owned", texture: key }]);
    ModelTextures.prototype.get = get;
    const owned = uncached.getMeshByName("owned")!.material as MeshBasicMaterial;
    t.is(Caching.materialCache.getIfPresent(`gui:${AssetLoader.context.cacheKey(key)}`), undefined);
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

test("shaped recipes trim outer spaces, preserve gaps, and center single dimensions", t => {
    const recipe = Object.freeze({
        type: "minecraft:crafting_shaped",
        pattern: Object.freeze(["   ", "  I", " I "]),
        key: Object.freeze({ I: "minecraft:iron_ingot" }),
        result: Object.freeze({ id: "minecraft:shears", count: 1 })
    } as const);
    const original = JSON.stringify(recipe);
    const layers = GuiHelper.recipe(recipe);
    t.deepEqual(layers.map(layer => "item" in layer
        ? { ...layer, item: (layer.item as AssetKey).toNamespacedString() } : layer), [
        { name: "background", texture: "minecraft:gui/container/crafting_table", crop: [0, 0, 176, 166] },
        { name: "ingredient-1", item: "minecraft:item/iron_ingot", position: [48, 17] },
        { name: "ingredient-3", item: "minecraft:item/iron_ingot", position: [30, 35] },
        { name: "result", item: "minecraft:item/shears", position: [124, 35] }
    ]);
    t.is(JSON.stringify(recipe), original);
    const spaced = GuiHelper.recipe({
        type: "crafting_shaped", pattern: [" A ", "   ", " A "],
        key: { A: "stick" }, result: { id: "test:tools/staff" }
    });
    t.deepEqual(spaced.slice(1, -1).map(({ name, position }) => ({ name, position })), [
        { name: "ingredient-1", position: [48, 17] },
        { name: "ingredient-7", position: [48, 53] }
    ]);
    t.is((spaced[spaced.length - 1] as { item: AssetKey }).item.toNamespacedString(), "test:item/tools/staff");
    const single = GuiHelper.recipe({ ...recipe, pattern: ["I"] });
    t.like(single[1], { name: "ingredient-4", position: [48, 35] });
});

test("shapeless recipes resolve tags and alternatives without changing legacy item keys", t => {
    const alternatives = Object.freeze([{ item: "minecraft:stick" }, { item: "minecraft:bamboo" }] as const);
    const ingredients = Object.freeze([
        { item: "test:tools/hammer" }, { tag: "minecraft:planks" }, "#minecraft:logs", alternatives
    ] as const);
    const recipe = Object.freeze({
        type: "crafting_shapeless", ingredients, result: { item: "test:assembled/tool", count: 2 }
    } as const);
    const original = JSON.stringify(recipe);
    const selected = new AssetKey("pack", "handles/bamboo", "models", "item", "assets", ".json", "test-root");
    const resolved: unknown[] = [];
    const layers = GuiHelper.recipe(recipe, { resolveIngredient: ingredient => {
        resolved.push(ingredient);
        return ingredient === alternatives ? selected
            : ingredient === ingredients[1] ? "test:woods/plank" : "oak_log";
    } });
    t.deepEqual(resolved, [ingredients[1], ingredients[2], alternatives]);
    t.is(resolved[0], ingredients[1]);
    t.is(resolved[2], alternatives);
    t.deepEqual(layers.slice(1).map(layer => ({
        ...layer, item: (layer as { item: AssetKey }).item.toNamespacedString()
    })), [
        { name: "ingredient-0", item: "test:item/tools/hammer", position: [30, 17] },
        { name: "ingredient-1", item: "test:item/woods/plank", position: [48, 17] },
        { name: "ingredient-2", item: "minecraft:item/oak_log", position: [66, 17] },
        { name: "ingredient-3", item: "pack:item/handles/bamboo", position: [30, 35] },
        { name: "result", item: "test:item/assembled/tool", position: [124, 35] }
    ]);
    t.is((layers[4] as { item: AssetKey }).item, selected);
    t.is(JSON.stringify(recipe), original);
});

test("recipes reject invalid crafting layouts and ingredients without concrete selections", t => {
    const shaped = { type: "crafting_shaped", key: { A: "stone" }, result: { id: "stone" } } as const;
    for (const pattern of [[], [""], ["AAAA"], ["A", "A", "A", "A"], ["A", "AA"], ["   "], ["B"]]) {
        t.throws(() => GuiHelper.recipe({ ...shaped, pattern }));
    }
    const shapeless = { type: "minecraft:crafting_shapeless", result: { id: "stone" } } as const;
    for (const ingredients of [[], Array(10).fill("stone")]) {
        t.throws(() => GuiHelper.recipe({ ...shapeless, ingredients }));
    }
    for (const ingredient of ["#minecraft:logs", { tag: "minecraft:logs" }, ["oak_log", "birch_log"]]) {
        const recipe = { ...shapeless, ingredients: [ingredient] };
        t.throws(() => GuiHelper.recipe(recipe), { message: /Select a concrete item/ });
        t.throws(() => GuiHelper.recipe(recipe, { resolveIngredient: () => "#minecraft:logs" }), {
            message: /Select a concrete item/
        });
    }
    t.throws(() => GuiHelper.recipe({ ...shapeless, type: "minecraft:smelting", ingredients: ["stone"] } as any), {
        message: /Unsupported crafting recipe type/
    });
});


test.serial("GUI materials share within a context and stay separate between contexts", async t => {
    fixture(t);
    const first = new AssetContext(), second = new AssetContext();
    const scenes = [new MineRenderScene({ assets: first }), new MineRenderScene({ assets: second })];
    const canvases = [{ width: 16, height: 16 }, { width: 32, height: 32 }];
    const requests: AssetContext[] = [];
    ModelTextures.prototype.get = async function(key) {
        const assets = this["assets"];
        requests.push(assets);
        Caching.textureAssetCache.get(assets.cacheKey(key), async () => ({ key } as TextureAsset));
        const canvas = canvases[assets === first ? 0 : 1];
        return { ...canvas, data: { canvas } } as unknown as ExtractableImageData;
    };
    const layers = [{ name: "panel", texture: "test:gui/panel" }];
    const [a, b] = await Promise.all(scenes.map(async scene => {
        const gui = new GuiObject(layers);
        gui.scene = scene;
        await gui.init();
        scene.add(gui);
        return gui;
    }));
    const repeated = await scenes[0].addGui(layers);
    t.teardown(() => { for (const gui of [a, b, repeated]) gui.dispose(); });
    const material = (gui: typeof a) => gui.getMeshByName("panel")!.material as MeshBasicMaterial;
    t.is(material(a), material(repeated));
    t.not(material(a), material(b));
    t.is(material(a).map!.image, canvases[0]);
    t.is(material(b).map!.image, canvases[1]);
    t.deepEqual(requests, [first, second]);
});
