import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Fonts } from "../src/assets/Fonts";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { ImageLoader } from "../src/image/ImageLoader";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { Maybe } from "../src/util";

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey, parser: AssetParser | string) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.load(key, parser) as Maybe<T>;
    }
}

const originalSources = [...AssetLoader["_SOURCES"]];
const originalRoot = AssetLoader.ROOT;
const originalDecode = ImageLoader.infoToCanvasData;
const sheets = new Map<string, ExtractableImageData>();

function sheet(name: string, width: number, height: number, opaque: [number, number][]) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of opaque) pixels[(y * width + x) * 4 + 3] = 255;
    const canvas = { width, height };
    const image = { width, height, data: { canvas, getImageData: () => ({ data: pixels }) } } as unknown as ExtractableImageData;
    sheets.set(name, image);
    return { src: name, width, height, data: Buffer.alloc(0) };
}

test.beforeEach(() => {
    Caching.clear();
    AssetLoader["_SOURCES"] = [];
    sheets.clear();
    ImageLoader.infoToCanvasData = async info => sheets.get(info.src!)!;
});
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    AssetLoader.ROOT = originalRoot;
    ImageLoader.infoToCanvasData = originalDecode;
    Caching.clear();
});

test.serial("font stacks preserve source and provider precedence through references and default filters", async t => {
    const requests: string[] = [];
    AssetLoader.addSource("low", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        requests.push(`low:${key.toNamespacedString()}`);
        if (key.path === "default") return { providers: [{ type: "space", advances: { A: 20, B: 4 } }] };
        if (key.path === "extra") return { providers: [{ type: "space", advances: { C: 9, D: 6 } }] };
        return undefined;
    }));
    AssetLoader.addSource("high", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        requests.push(`high:${key.toNamespacedString()}`);
        if (key.path === "default") return { providers: [
            { type: "space", advances: { A: 2 } },
            { type: "space", advances: { A: 10 } },
            { type: "reference", id: "custom:extra", filter: { uniform: false, jp: false } },
            { type: "reference", id: "custom:uniform", filter: { uniform: true } },
            { type: "reference", id: "custom:japanese", filter: { jp: true } },
            { type: "unihex", hex_file: "minecraft:font/unifont.zip" },
            { type: "ttf", file: "custom:font.ttf" }
        ] };
        if (key.path === "extra") return { providers: [{ type: "minecraft:space", advances: { C: 7, "\0": 3 } }] };
        return undefined;
    }));
    const font = await Fonts.get();
    t.deepEqual([...font.glyphs].map(([character, glyph]) => [character, glyph.advance]), [["A", 2], ["C", 7], ["D", 6], ["B", 4]]);
    t.is(font.glyphs.get("A")!.image, undefined);
    t.deepEqual(requests, ["high:minecraft:default", "low:minecraft:default", "high:custom:extra", "low:custom:extra"]);
});

test.serial("bitmap glyphs use codepoint cells, alpha widths, height and ascent while retaining the font root", async t => {
    const first = sheet("first", 12, 16, [[2, 0], [10, 7]]);
    const second = sheet("second", 4, 8, [[3, 0]]);
    const requests: AssetKey[] = [];
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        requests.push(key);
        if (key.assetType === "textures") {
            t.is(parser, AssetParser.IMAGE);
            return key.path === "first" ? first : second;
        }
        t.is(parser, AssetParser.JSON);
        if (key.namespace === "custom") return { providers: [{ type: "reference", id: "include/metrics" }] };
        return { providers: [
            { type: "bitmap", file: "paint:font/first.png", height: 12, ascent: 10, chars: ["A😀", "\0B"] },
            { type: "minecraft:bitmap", file: "font/second.png", ascent: 7, chars: ["X"] }
        ] };
    }));
    const key = new AssetKey("custom", "label", "font", undefined, "assets", ".json", "https://pack.example/custom");
    const font = await Fonts.get(key);
    const a = font.glyphs.get("A")!, emoji = font.glyphs.get("😀")!, blank = font.glyphs.get("B")!;
    t.deepEqual({ ...a, image: undefined }, { x: 0, y: 0, width: 6, height: 8, scale: 1.5, ascent: 10, advance: 6, image: undefined });
    t.deepEqual({ ...emoji, image: undefined }, { x: 6, y: 0, width: 6, height: 8, scale: 1.5, ascent: 10, advance: 9, image: undefined });
    t.deepEqual([blank.x, blank.y, blank.advance], [6, 8, 1]);
    t.deepEqual([font.glyphs.get("X")!.scale, font.glyphs.get("X")!.advance], [1, 5]);
    t.is(a.image, (sheets.get("first")!.data as CanvasRenderingContext2D).canvas);
    t.false(font.glyphs.has("\0"));
    t.is(font.glyphs.size, 4);
    t.deepEqual(requests.map(request => [request.assetType, request.toNamespacedString(), request.extension, request.root]), [
        ["font", "custom:label", ".json", key.root],
        ["font", "minecraft:include/metrics", ".json", key.root],
        ["textures", "paint:font/first", ".png", key.root],
        ["textures", "minecraft:font/second", ".png", key.root]
    ]);
});

test.serial("font caches reuse loads and clear with source or version changes", async t => {
    let advance = 3;
    const requests: AssetKey[] = [];
    AssetLoader.addSource("test", new StubSource(key => {
        requests.push(key);
        return { providers: [{ type: "space", advances: { " ": advance } }] };
    }));
    const first = await Fonts.get("custom:label");
    t.is(await Fonts.get("custom:label"), first);
    t.is(requests.length, 1);
    advance = 5;
    Caching.clear();
    const replacement = await Fonts.get("custom:label");
    t.not(replacement, first);
    t.is(replacement.glyphs.get(" ")!.advance, 5);
    t.is(first.glyphs.get(" ")!.advance, 3);
    AssetLoader.ROOT = "https://assets.mcasset.cloud/1.20.1";
    t.not(await Fonts.get("custom:label"), replacement);
    t.is(requests.length, 3);
});

test.serial("missing font files and reference cycles reject without leaving rejected cache entries", async t => {
    let repaired = false;
    AssetLoader.addSource("test", new StubSource(key => {
        if (key.path === "missing") return undefined;
        if (repaired) return { providers: [{ type: "space", advances: { " ": 4 } }] };
        return { providers: [{ type: "reference", id: key.path === "first" ? "custom:second" : "custom:first" }] };
    }));
    await t.throwsAsync(Fonts.get("custom:missing"), { message: "Could not load font custom:missing" });
    await t.throwsAsync(Fonts.get("custom:first"), { message: "Cyclic font reference: custom:first" });
    repaired = true;
    t.is((await Fonts.get("custom:first")).glyphs.get(" ")!.advance, 4);
});
