import test from "ava";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { Env, type EnvProvider } from "../src/Env";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { layoutGuiText, createGuiTextGeometry } from "../src/gui/GuiText";
import { Fonts } from "../src/assets/Fonts";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { ImageLoader } from "../src/image/ImageLoader";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { Maybe } from "../src/util";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey, parser: AssetParser | string) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.load(key, parser) as Maybe<T>;
    }
}

const originalSources = [...AssetLoader["_SOURCES"]];
const originalRoot = AssetLoader.ROOT;
const originalDecode = ImageLoader.infoToCanvasData;
const originalProvider = Env["_provider"];
const sheets = new Map<string, ExtractableImageData>();
const canvases: (CompatCanvas & { pixels: Uint8ClampedArray })[] = [];

async function unihexArchive(files: Record<string, string>) {
    const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: false });
    for (const [name, contents] of Object.entries(files)) await zip.add(name, new TextReader(contents));
    return { data: await zip.close() };
}

function hexGlyph(codepoint: string, rows: string[]) {
    return `${codepoint}:${rows.join("")}`;
}

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
    canvases.length = 0;
    ImageLoader.infoToCanvasData = async info => sheets.get(info.src!)!;
    Env.register({ name: "test", createCanvas: (width, height) => {
        const canvas = { width, height, pixels: new Uint8ClampedArray(width * height * 4), getContext: () => ({
            createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: (image: { width: number, height: number, data: Uint8ClampedArray }, dx: number, dy: number) => {
                for (let y = 0; y < image.height; y++) {
                    const start = y * image.width * 4;
                    canvas.pixels.set(image.data.subarray(start, start + image.width * 4), ((dy + y) * canvas.width + dx) * 4);
                }
            }
        }) } as unknown as CompatCanvas & { pixels: Uint8ClampedArray };
        canvases.push(canvas);
        return canvas;
    } } as EnvProvider);
});
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    AssetLoader.ROOT = originalRoot;
    ImageLoader.infoToCanvasData = originalDecode;
    Env["_provider"] = originalProvider;
    Caching.clear();
});

test.serial("font stacks preserve source and provider precedence through references and default filters", async t => {
    const requests: string[] = [];
    const archive = await unihexArchive({ "glyphs.hex": [
        hexGlyph("0041", Array(16).fill("FF")), hexGlyph("03A9", Array(16).fill("7E"))
    ].join("\n") });
    AssetLoader.addSource("low", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        requests.push(`low:${key.toNamespacedString()}`);
        if (key.path === "default") return { providers: [{ type: "space", advances: { A: 20, B: 4 } }] };
        if (key.path === "extra") return { providers: [{ type: "space", advances: { C: 9, D: 6 } }] };
        return undefined;
    }));
    AssetLoader.addSource("high", new StubSource((key, parser) => {
        requests.push(`high:${key.toNamespacedString()}`);
        if (key.path.endsWith(".zip")) {
            t.is(parser, AssetParser.BINARY);
            return archive;
        }
        t.is(parser, AssetParser.JSON);
        if (key.path === "default") return { providers: [
            { type: "space", advances: { A: 2 } },
            { type: "space", advances: { A: 10 } },
            { type: "reference", id: "custom:extra", filter: { uniform: false, jp: false } },
            { type: "reference", id: "custom:uniform", filter: { uniform: true } },
            { type: "reference", id: "custom:japanese", filter: { jp: true } },
            { type: "unihex", hex_file: "minecraft:font/unifont.zip" },
            { type: "unihex", hex_file: "minecraft:font/uniform.zip", filter: { uniform: true } },
            { type: "ttf", file: "custom:font.ttf" }
        ] };
        if (key.path === "extra") return { providers: [{ type: "minecraft:space", advances: { C: 7, "\0": 3 } }] };
        return undefined;
    }));
    const font = await Fonts.get();
    await font.resolve!("ACDΩB");
    t.deepEqual([...font.glyphs].map(([character, glyph]) => [character, glyph.advance]), [["A", 2], ["C", 7], ["D", 6], ["Ω", 4], ["B", 4]]);
    t.is(font.glyphs.get("A")!.image, undefined);
    t.deepEqual(requests, ["high:minecraft:default", "low:minecraft:default", "high:custom:extra", "low:custom:extra", "high:minecraft:font/unifont.zip"]);
});

test.serial("Unihex glyphs retain widths, overrides, codepoints, root, and pixels without rasterizing during loading", async t => {
    const archive = await unihexArchive({
        "first.hex": hexGlyph("0041", Array(16).fill("FF")),
        "nested/glyphs.hex": [
            hexGlyph("0041", ["18", "24", ...Array(14).fill("00")]),
            hexGlyph("0042", ["8001", ...Array(15).fill("0000")]),
            hexGlyph("0043", ["800001", ...Array(15).fill("000000")]),
            hexGlyph("01F600", ["80000001", ...Array(15).fill("00000000")]),
            hexGlyph("0044", Array(16).fill("00")),
            hexGlyph("0045", ["0180", ...Array(15).fill("0000")])
        ].join("\n"),
        "ignored.txt": "This is not a hexadecimal glyph.",
        "ignored.HEX": "This filename does not use the .hex extension."
    });
    const requests: { key: AssetKey, parser: AssetParser | string }[] = [];
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        requests.push({ key, parser });
        if (parser === AssetParser.BINARY) return archive;
        return { providers: [{ type: "minecraft:unihex", hex_file: "paint:font/nested/unifont.zip", size_overrides: [
            { from: "E", to: "F", left: 0, right: 15 },
            { from: "E", to: "G", left: 7, right: 8 }
        ] }] };
    }));
    const key = new AssetKey("custom", "label", "font", undefined, "assets", ".json", "https://pack.example/custom");
    const font = await Fonts.get(key);
    await font.resolve!("ABC😀DE");
    t.deepEqual([...font.glyphs.keys()], ["A", "B", "C", "😀", "D", "E"]);
    t.deepEqual([...font.glyphs.values()].map(glyph => [glyph.width, glyph.height, glyph.scale, glyph.ascent, glyph.advance]), [
        [4, 16, 0.5, 7, 3], [16, 16, 0.5, 7, 9], [24, 16, 0.5, 7, 13],
        [32, 16, 0.5, 7, 17], [9, 16, 0.5, 7, 5], [16, 16, 0.5, 7, 9]
    ]);
    t.is(canvases.length, 0);
    t.is(await Fonts.get(key), font);
    t.is(requests.length, 2);
    const binary = requests[1];
    t.is(binary.parser, AssetParser.BINARY);
    t.deepEqual([binary.key.assetType, binary.key.type, binary.key.path, binary.key.extension, binary.key.root],
        [undefined, "font", "nested/unifont.zip", "", key.root]);
    t.is(binary.key.namespace, "paint");
    const glyph = font.glyphs.get("A")!;
    t.deepEqual([glyph.boldOffset, glyph.shadowOffset], [0.5, 0.5]);
    const image = glyph.image as CompatCanvas & { pixels: Uint8ClampedArray };
    t.is(canvases.length, 1);
    const pixel = (x: number, y: number) => Array.from(image.pixels.subarray(((glyph.y + y) * image.width + glyph.x + x) * 4,
        ((glyph.y + y) * image.width + glyph.x + x) * 4 + 4));
    t.deepEqual(pixel(1, 0), [255, 255, 255, 255]);
    t.deepEqual(pixel(2, 0), [255, 255, 255, 255]);
    t.is(pixel(0, 0)[3], 0);
    t.is(pixel(3, 0)[3], 0);
    t.deepEqual(pixel(0, 1), [255, 255, 255, 255]);
    t.deepEqual(pixel(3, 1), [255, 255, 255, 255]);
    t.is(glyph.image, image);
    t.is(canvases.length, 1);
    for (const character of ["B", "C", "😀"]) {
        const wide = font.glyphs.get(character)!;
        const canvas = wide.image as CompatCanvas & { pixels: Uint8ClampedArray };
        for (const x of [0, wide.width - 1]) {
            const start = (wide.y * canvas.width + wide.x + x) * 4;
            t.deepEqual(Array.from(canvas.pixels.subarray(start, start + 4)), [255, 255, 255, 255]);
        }
    }
    const blank = font.glyphs.get("D")!;
    const blankImage = blank.image as CompatCanvas & { pixels: Uint8ClampedArray };
    for (let y = 0; y < blank.height; y++) {
        const start = ((blank.y + y) * blankImage.width + blank.x) * 4;
        t.true(blankImage.pixels.subarray(start, start + blank.width * 4).every(value => value === 0));
    }
});

test.serial("Unihex atlas rollover preserves rendered glyphs and override columns outside source pixels stay transparent", async t => {
    const characters = Array.from({ length: 1025 }, (_, index) => String.fromCodePoint(0x0100 + index));
    const archive = await unihexArchive({ "glyphs.hex": [
        ...characters.map(character => hexGlyph(character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
            ["80000001", ...Array(15).fill("00000000")])),
        hexGlyph("2211", ["81", ...Array(15).fill("00")])
    ].join("\n") });
    AssetLoader.addSource("test", new StubSource((_key, parser) => parser === AssetParser.BINARY ? archive :
        { providers: [{ type: "unihex", hex_file: "font/unifont.zip",
            size_overrides: [{ from: "∑", to: "−", left: -2, right: 34 }] }] }));
    const font = await Fonts.get();
    await font.resolve!(characters.join("") + "∑");
    t.is(canvases.length, 0);
    const first = font.glyphs.get(characters[0])!;
    const image = first.image as CompatCanvas & { pixels: Uint8ClampedArray };
    const placement = [first.x, first.y];
    const capacity = Math.floor(image.width / first.width) * Math.floor(image.height / first.height);
    t.true(capacity < characters.length);
    for (const character of characters.slice(1, capacity)) t.is(font.glyphs.get(character)!.image, image);
    t.is(canvases.length, 1);
    const nextPage = font.glyphs.get(characters[capacity])!;
    t.not(nextPage.image, image);
    t.is(canvases.length, 2);
    t.deepEqual([nextPage.x, nextPage.y], [0, 0]);
    t.is(first.image, image);
    t.deepEqual([first.x, first.y], placement);
    for (const x of [0, first.width - 1]) {
        const start = (first.y * image.width + first.x + x) * 4;
        t.deepEqual(Array.from(image.pixels.subarray(start, start + 4)), [255, 255, 255, 255]);
    }
    const padded = font.glyphs.get("∑")!;
    t.deepEqual([padded.width, padded.advance], [37, 19]);
    const paddedImage = padded.image as CompatCanvas & { pixels: Uint8ClampedArray };
    const alpha = Array.from({ length: padded.width }, (_, x) =>
        paddedImage.pixels[(padded.y * paddedImage.width + padded.x + x) * 4 + 3]);
    t.deepEqual(alpha.flatMap((value, index) => value ? [index] : []), [2, 9]);
});

test.serial("missing and malformed Unihex archives warn and can be retried after repair", async t => {
    const warn = console.warn, warnings: unknown[][] = [];
    console.warn = (...args) => { warnings.push(args); };
    t.teardown(() => { console.warn = warn; });
    let archive: { data: Uint8Array } | undefined;
    AssetLoader.addSource("test", new StubSource((_key, parser) => parser === AssetParser.BINARY ? archive :
        { providers: [{ type: "unihex", hex_file: "minecraft:font/unifont.zip" }] }));
    const font = await Fonts.get();
    await font.resolve!("A");
    t.false(font.glyphs.has("A"));
    for (const contents of [
        "0041:FF", hexGlyph("0041", Array(16).fill("ff")),
        `\n${hexGlyph("0041", Array(16).fill("FF"))}`,
        `${hexGlyph("0041", Array(16).fill("FF"))}\r\n`
    ]) {
        archive = await unihexArchive({ "glyphs.hex": contents });
        await font.resolve!("A");
        t.false(font.glyphs.has("A"));
    }
    archive = await unihexArchive({ "glyphs.hex": `${hexGlyph("0041", Array(16).fill("FF"))}\n` });
    t.is(warnings.length, 5);
    t.true(warnings.every(args => String(args[0]).includes("minecraft:font/unifont.zip")));
    await font.resolve!("A");
    t.is(font.glyphs.get("A")!.advance, 5);
    Caching.clear();
    archive = await unihexArchive({ "empty.hex": "", "readme.txt": "No glyphs." });
    const empty = await Fonts.get();
    await empty.resolve!("A");
    t.is(empty.glyphs.size, 0);
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

test.serial("bitmap text skips a referenced Unihex file and fonts share its parsed records", async t => {
    const archive = await unihexArchive({ "glyphs.hex": hexGlyph("03A9", Array(16).fill("FF")) });
    const image = sheet("ascii", 8, 8, [[3, 0]]);
    let loads = 0;
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        if (parser === AssetParser.BINARY) { loads++; return archive; }
        if (parser === AssetParser.IMAGE) return image;
        return { providers: key.path === "default" ? [
            { type: "bitmap", file: "font/ascii.png", ascent: 7, chars: ["A"] },
            { type: "reference", id: "custom:unicode" }
        ] : [{ type: "unihex", hex_file: "pack:font/glyphs.bin" }] };
    }));
    t.is((await layoutGuiText("AAA")).width, 15);
    t.is(loads, 0);
    const [layout] = await Promise.all([layoutGuiText("Ω"), layoutGuiText("Ω", { font: "custom:unicode" })]);
    t.is(layout.width, 5);
    t.is(loads, 1);
    const fileKey = new AssetKey("pack", "glyphs.bin", undefined, "font", "assets", "").serialize();
    const parsed = await Caching.unihexCache.getIfPresent(fileKey);
    t.is(parsed!.rows.length, 16);
    await layoutGuiText("ΩΩ");
    t.is(loads, 1);
    t.is(await Caching.unihexCache.getIfPresent(fileKey), parsed);
    Caching.clear();
    await layoutGuiText("Ω");
    t.is(loads, 2);
});

test.serial("Unihex before bitmap wins and archive paths are used as written", async t => {
    const archive = await unihexArchive({ "glyphs.hex": hexGlyph("0041", Array(16).fill("FF")) });
    const image = sheet("ascii", 8, 8, [[1, 0]]);
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        if (parser === AssetParser.BINARY) {
            t.deepEqual([key.namespace, key.getFullPath(), key.extension], ["pack", "font/glyphs.bin", ""]);
            return archive;
        }
        if (parser === AssetParser.IMAGE) return image;
        return { providers: [{ type: "unihex", hex_file: "pack:font/glyphs.bin" },
            { type: "bitmap", file: "font/ascii.png", ascent: 7, chars: ["A"] }] };
    }));
    t.is((await layoutGuiText("A")).width, 5);
});

test.serial("failing Unihex providers preserve other glyphs and draw missing-glyph boxes", async t => {
    const archive = await unihexArchive({ "glyphs.hex": hexGlyph("03A9", Array(16).fill("FF")) });
    const warn = console.warn, warnings: unknown[][] = [];
    console.warn = (...args) => { warnings.push(args); };
    t.teardown(() => { console.warn = warn; });
    for (const invalidOverride of [false, true]) {
        Caching.clear();
        AssetLoader["_SOURCES"] = [];
        AssetLoader.addSource("test", new StubSource((_key, parser) => parser === AssetParser.BINARY
            ? (invalidOverride ? archive : undefined) : { providers: [
                { type: "unihex", hex_file: "font/unifont.zip",
                    size_overrides: invalidOverride ? [{ from: "Ω", to: "Ω", left: 0, right: 7 }] : [] },
                { type: "space", advances: { A: 3 } }
            ] }));
        const layout = await layoutGuiText("AΩ");
        t.deepEqual(layout.glyphs.map(entry => entry.advance), [3, 6]);
        t.is(layout.glyphs[1].glyph, undefined);
        const batches = createGuiTextGeometry(layout, false);
        t.true(batches.some(batch => !batch.image && batch.geometry.index!.count > 0));
        batches.forEach(batch => batch.geometry.dispose());
    }
    t.is(warnings.length, 2);
    t.true(warnings.every(args => String(args[0]).includes("font/unifont.zip")));
});
