import test, { type ExecutionContext } from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { Fonts, type BitmapGlyph } from "../src/assets/Fonts";
import { GuiHelper } from "../src/gui/GuiHelper";
import type { GuiTextLayer, GuiTextureLayer } from "../src/gui/GuiLayer";

function fixture(t: ExecutionContext) {
    const get = Fonts.get;
    const glyphs = new Map<string, BitmapGlyph>();
    for (const [character, advance] of [["A", 6], ["B", 5], [" ", 3]] as const) {
        glyphs.set(character, { x: 0, y: 0, width: 0, height: 0, scale: 1, ascent: 7, advance });
    }
    Fonts.get = async () => ({ glyphs });
    t.teardown(() => { Fonts.get = get; });
}

test.serial("tooltips size the frame around text with vanilla padding and title spacing", async t => {
    fixture(t);
    t.deepEqual(await GuiHelper.tooltip([]), []);
    const single = await GuiHelper.tooltip(["A"]);
    t.like(single[0], {
        texture: "minecraft:gui/sprites/tooltip/background", position: [-12, -12], size: [30, 32]
    });
    t.like(single[1], {
        texture: "minecraft:gui/sprites/tooltip/frame", position: [-12, -12], size: [30, 32]
    });
    t.like(single[2], { text: "A", position: [0, 0], lineHeight: 10, shadow: true });

    const multiple = await GuiHelper.tooltip(["AA", "B"], { position: [5, 7] });
    t.like(multiple[0], { position: [-7, -5], size: [36, 44] });
    t.deepEqual(multiple.slice(2).map(layer => layer.position), [[5, 7], [5, 19]]);
});

test.serial("wrapped tooltip text retains run styles and positions body lines below the title", async t => {
    fixture(t);
    const title = Object.freeze([Object.freeze({ text: "AA AA", color: 0x55ffff })]);
    const body = Object.freeze([Object.freeze({ text: "B", italic: true })]);
    const lines = Object.freeze([title, body]);
    const font = new AssetKey("test", "tooltip", "font");
    const layers = await GuiHelper.tooltip(lines, {
        font, position: [9, 17], maxWidth: 12, lineHeight: 11, titleGap: 4, shadow: false
    });
    const background = layers[0] as GuiTextureLayer;
    const texts = layers.slice(2) as GuiTextLayer[];
    t.deepEqual(background.position, [-3, 5]);
    t.deepEqual(background.size, [36, 59]);
    t.deepEqual(texts.map(layer => layer.position), [[9, 17], [9, 43]]);
    t.is(texts[0].text, title);
    t.is(texts[1].text, body);
    t.true(texts.every(layer => layer.font === font && layer.maxWidth === 12 && layer.lineHeight === 11 && !layer.shadow));
});
