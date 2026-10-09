import test, { type ExecutionContext } from "ava";
import { Box3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import { GUI_CONTAINER_LAYOUTS, GuiHelper } from "../src/gui/GuiHelper";
import type { GuiTextLayer, GuiTextureLayer } from "../src/gui/GuiLayer";
import type { TextureAsset } from "../src/model/Model";
import { MineRenderScene } from "../src/renderer/MineRenderScene";

function fixture(t: ExecutionContext) {
    const preload = ModelTextures.preload, get = ModelTextures.get, getMeta = ModelTextures.getMeta;
    const requests: string[] = [];
    const scene = new MineRenderScene();
    const dimensions = (key: AssetKey): [number, number] => {
        const path = key.getFullPath();
        if (path.startsWith("gui/sprites/boss_bar/")) return [364, 10];
        if (path.startsWith("gui/sprites/widget/page_")) return [46, 26];
        if (path === "gui/book" || path.startsWith("gui/container/")) return [512, 512];
        throw new Error(`Unexpected GUI texture ${path}`);
    };
    ModelTextures.preload = async key => {
        requests.push(key.toNamespacedString());
        const [width, height] = dimensions(key);
        return { key, width, height } as TextureAsset;
    };
    ModelTextures.get = async key => {
        const [width, height] = dimensions(key);
        return { width, height, data: { canvas: { width, height } } } as unknown as ExtractableImageData;
    };
    ModelTextures.getMeta = async () => undefined;
    Caching.clear();
    t.teardown(() => {
        ModelTextures.preload = preload;
        ModelTextures.get = get;
        ModelTextures.getMeta = getMeta;
        for (const object of [...scene.children]) {
            if ("dispose" in object) (object as { dispose(): void }).dispose();
            object.removeFromParent();
        }
        Caching.clear();
    });
    return { scene, requests };
}

test.serial("boss bars keep pixel progress and bounds with high-resolution textures", async t => {
    const { scene } = fixture(t);
    const defaults = await GuiHelper.bossBar() as GuiTextureLayer[];
    t.like(defaults[0], { name: "boss-bar-background", texture: "minecraft:gui/sprites/boss_bar/pink_background" });
    t.like(defaults[1], { name: "boss-bar-progress", size: [182, 5] });
    for (const color of ["pink", "blue", "red", "green", "yellow", "purple", "white"] as const) {
        const layers = await GuiHelper.bossBar({ color }) as GuiTextureLayer[];
        t.deepEqual(layers.map(layer => layer.texture), [
            `minecraft:gui/sprites/boss_bar/${color}_background`,
            `minecraft:gui/sprites/boss_bar/${color}_progress`
        ]);
    }
    for (const [progress, width] of [[-1, 0], [0, 0], [Number.MIN_VALUE, 1], [0.5, 91], [1, 182], [2, 182]]) {
        const options = Object.freeze({ progress, position: Object.freeze([10, -4]) as unknown as [number, number] });
        const original = JSON.stringify(options);
        const layers = await GuiHelper.bossBar(options);
        const gui = await scene.addGui(layers);
        t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[10, -4], [192, 1]]);
        const fill = gui.getMeshByName("boss-bar-progress");
        if (!width) {
            t.falsy(fill);
            t.is(layers.length, 1);
        } else {
            t.truthy(fill);
            const bounds = new Box3().setFromObject(fill!);
            t.deepEqual([bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y], [10, -1, 10 + width, 4]);
            const uv = fill!.geometry.getAttribute("uv");
            t.is(uv.getX(0), 0);
            t.true(Math.abs(uv.getX(1) - width / 182) < 1e-7);
            t.deepEqual([uv.getY(0), uv.getY(2)], [1, 0]);
        }
        t.is(JSON.stringify(options), original);
    }
});

test.serial("GUI layout helpers reject invalid options before loading textures", async t => {
    const { requests } = fixture(t);
    for (const progress of [NaN, Infinity, -Infinity]) {
        await t.throwsAsync(GuiHelper.bossBar({ progress }));
    }
    await t.throwsAsync(GuiHelper.bossBar({ color: "orange" as any }));
    await t.throwsAsync(GuiHelper.book({ previous: "disabled" as any }));
    await t.throwsAsync(GuiHelper.book({ next: "disabled" as any }));
    await t.throwsAsync(GuiHelper.container("furnace" as any));
    for (const position of [[NaN, 0], [0, Infinity], [0], [0, 0, 0]] as [number, number][]) {
        await t.throwsAsync(GuiHelper.bossBar({ position }));
        await t.throwsAsync(GuiHelper.book({ position }));
        await t.throwsAsync(GuiHelper.container("generic_54", position));
    }
    t.deepEqual(requests, []);
});

test.serial("book pages crop high-resolution backgrounds and place normal and hovered arrows", async t => {
    const { scene } = fixture(t);
    const defaults = await GuiHelper.book();
    t.is(defaults.length, 1);
    t.is(defaults[0].name, "book-background");
    const layers = await GuiHelper.book({ position: [7, 11], previous: "normal", next: "hover" });
    const gui = await scene.addGui(layers);
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[7, 11], [199, 203]]);
    const background = gui.getMeshByName("book-background")!;
    t.deepEqual(Array.from(background.geometry.getAttribute("uv").array), [0, 1, 0.75, 1, 0, 0.25, 0.75, 0.25]);
    t.like(layers.find(layer => layer.name === "book-previous"), {
        texture: "minecraft:gui/sprites/widget/page_backward", position: [50, 168], size: [23, 13]
    });
    t.like(layers.find(layer => layer.name === "book-next"), {
        texture: "minecraft:gui/sprites/widget/page_forward_highlighted", position: [123, 168], size: [23, 13]
    });
    const reversed = await GuiHelper.book({ previous: "hover", next: "normal" }) as GuiTextureLayer[];
    t.is(reversed.find(layer => layer.name === "book-previous")!.texture, "minecraft:gui/sprites/widget/page_backward_highlighted");
    t.is(reversed.find(layer => layer.name === "book-next")!.texture, "minecraft:gui/sprites/widget/page_forward");
});

test.serial("book text keeps caller content and styles with vanilla page defaults", async t => {
    fixture(t);
    const defaults = await GuiHelper.book({ text: "A page" });
    t.like(defaults.find(layer => layer.name === "book-text"), {
        text: "A page", position: [36, 30], color: 0, shadow: false, lineHeight: 9, maxWidth: 114
    });
    t.deepEqual(await GuiHelper.book({
        text: "A page", color: undefined, shadow: undefined, lineHeight: undefined, maxWidth: undefined
    }), defaults);
    const text = Object.freeze([Object.freeze({ text: "Styled page", color: 0x55ffff })]);
    const options = Object.freeze({
        text, font: "test:book", position: Object.freeze([9, 17]) as unknown as [number, number],
        previous: "hover" as const, next: "hidden" as const,
        color: 0x123456, shadow: true, bold: true, lineHeight: 11, maxWidth: 100
    });
    const original = JSON.stringify(options);
    const layers = await GuiHelper.book(options);
    const body = layers.find(layer => layer.name === "book-text") as GuiTextLayer;
    t.is(body.text, text);
    t.like(body, {
        position: [45, 47], font: "test:book", color: 0x123456,
        shadow: true, bold: true, lineHeight: 11, maxWidth: 100
    });
    t.false("previous" in body || "next" in body);
    t.is(JSON.stringify(options), original);
});

test.serial("container presets share slot coordinates and crop high-resolution backgrounds", async t => {
    const { scene } = fixture(t);
    const original = JSON.stringify(GUI_CONTAINER_LAYOUTS);
    for (const [type, height, lastSlot] of [
        ["generic_54", 222, [152, 108]], ["crafting_table", 166, [66, 53]]
    ] as const) {
        const layout = GUI_CONTAINER_LAYOUTS[type];
        const layers = await GuiHelper.container(type, [3, 5]);
        const gui = await scene.addGui(layers);
        t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[3, 5], [179, 5 + height]]);
        const uv = gui.getMeshByName("background")!.geometry.getAttribute("uv");
        t.deepEqual([uv.getX(0), uv.getX(1), uv.getY(0), uv.getY(2)], [0, 176 / 256, 1, 1 - height / 256]);
        t.deepEqual(GuiHelper.inventorySlot(layout.slotCount - 1, layout.slotOrigin, layout.slotOffset, layout.rowSize), [...lastSlot]);
        (layers[0] as GuiTextureLayer).crop![2] = 1;
    }
    t.deepEqual(GUI_CONTAINER_LAYOUTS.crafting_table.resultPosition, [124, 35]);
    t.is(JSON.stringify(GUI_CONTAINER_LAYOUTS), original);
});
