import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { AssetKey } from "../AssetKey";
import { AssetLoader } from "../AssetLoader";
import { DEFAULT_NAMESPACE } from "../Assets";
import { Caching } from "../../cache/Caching";
import { AssetParser } from "../source/parser/AssetParsers";
import { createCanvas, type CompatCanvas } from "../../canvas/CanvasCompat";
import type { BitmapGlyph } from "../Fonts";
import type { BinaryAsset } from "../source/HostedAssetSource";

export interface UnihexProvider {
    type: "unihex" | "minecraft:unihex";
    hex_file: string;
    size_overrides?: { from: string; to: string; left: number; right: number }[];
}

interface HexGlyph {
    rows: Uint32Array;
    bitWidth: number;
    left: number;
    right: number;
}

export interface UnihexFile {
    indices: Int32Array;
    rows: Uint32Array;
    metrics: Uint8Array;
}

const ATLAS_SIZE = 512;
const GLYPH_HEIGHT = 16;

/** Packs glyphs into shared pages only when their pixels or source rectangles are requested. */
class UnihexAtlas {
    private image?: CompatCanvas;
    private x = 0;
    private y = 0;

    public draw(glyph: HexGlyph): { image: CompatCanvas; x: number; y: number } {
        const width = glyph.right - glyph.left + 1;
        if (this.image && this.x + width > this.image.width) {
            this.x = 0;
            this.y += GLYPH_HEIGHT;
        }
        if (!this.image || this.y + GLYPH_HEIGHT > this.image.height || width > this.image.width) {
            this.image = createCanvas(Math.max(ATLAS_SIZE, width), ATLAS_SIZE);
            this.x = 0;
            this.y = 0;
        }
        const context = this.image.getContext("2d") as CanvasRenderingContext2D;
        const pixels = context.createImageData(width, GLYPH_HEIGHT);
        for (let y = 0; y < GLYPH_HEIGHT; y++) {
            for (let x = 0; x < width; x++) {
                const column = glyph.left + x;
                if (column < 0 || column >= glyph.bitWidth || !(glyph.rows[y] >>> (glyph.bitWidth - column - 1) & 1)) continue;
                pixels.data.fill(255, (y * width + x) * 4, (y * width + x + 1) * 4);
            }
        }
        const result = { image: this.image, x: this.x, y: this.y };
        context.putImageData(pixels, this.x, this.y);
        this.x += width;
        return result;
    }
}

function readHex(text: string, filename: string, glyphs: Map<number, HexGlyph>): void {
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    lines.forEach((line, index) => {
        const match = /^([0-9A-F]{4,6}):([0-9A-F]+)$/.exec(line);
        if (!match || ![32, 64, 96, 128].includes(match[2].length)) {
            throw new Error(`Invalid Unihex record in ${filename} at line ${index + 1}`);
        }
        const codepoint = parseInt(match[1], 16);
        if (codepoint > 0x10ffff) throw new Error(`Invalid Unihex codepoint in ${filename} at line ${index + 1}`);
        const bitWidth = match[2].length / 4;
        const rowLength = bitWidth / 4;
        const rows = new Uint32Array(GLYPH_HEIGHT);
        let mask = 0;
        for (let y = 0; y < GLYPH_HEIGHT; y++) {
            rows[y] = parseInt(match[2].slice(y * rowLength, (y + 1) * rowLength), 16);
            mask |= rows[y];
        }
        let left = 0, right = bitWidth;
        if (mask) {
            while (!(mask >>> (bitWidth - left - 1) & 1)) left++;
            right = bitWidth - 1;
            while (!(mask >>> (bitWidth - right - 1) & 1)) right--;
        }
        glyphs.set(codepoint, { rows, bitWidth, left, right });
    });
}

const atlases = new WeakMap<UnihexProvider, UnihexAtlas>();

async function parseUnihex(key: AssetKey): Promise<UnihexFile | undefined> {
    try {
        const asset = await AssetLoader.get<BinaryAsset>(key, AssetParser.BINARY);
        if (!asset) throw new Error(`Could not load Unihex archive ${key.toNamespacedString()}`);
        const records = new Map<number, HexGlyph>();
        const reader = new ZipReader(new Uint8ArrayReader(asset.data), { useWebWorkers: false, useCompressionStream: false });
        try {
            for (const entry of await reader.getEntries()) {
                if (!entry.directory && entry.filename.endsWith(".hex")) {
                    readHex(await entry.getData!(new TextWriter(), { checkSignature: true }), entry.filename, records);
                }
            }
        } finally {
            await reader.close();
        }
        const indices = new Int32Array(0x110000).fill(-1);
        const rows = new Uint32Array(records.size * GLYPH_HEIGHT), metrics = new Uint8Array(records.size * 3);
        let index = 0;
        for (const [codepoint, record] of records) {
            indices[codepoint] = index;
            rows.set(record.rows, index * GLYPH_HEIGHT);
            metrics.set([record.bitWidth, record.left, record.right], index * 3);
            index++;
        }
        return { indices, rows, metrics };
    } catch (error) {
        console.warn(`Could not load Unihex file ${key.toNamespacedString()}`, error);
        return undefined;
    }
}

/** Resolves Unihex characters with vanilla metrics and lazily rasterized, half-resolution glyphs. */
export async function loadUnihex(provider: UnihexProvider, fontKey: AssetKey, characters: string): Promise<Map<string, BitmapGlyph>> {
    const origin = new AssetKey(DEFAULT_NAMESPACE, "", undefined, undefined, "assets", "", fontKey.root);
    const key = AssetKey.parse("font", provider.hex_file, origin);
    // Archive references already include their directory beneath the namespace root.
    key.assetType = undefined;
    const glyphs = new Map<string, BitmapGlyph>();
    let overrides;
    try {
        overrides = (provider.size_overrides ?? []).map(override => {
            const from = override.from.codePointAt(0), to = override.to.codePointAt(0);
            if ([...override.from].length !== 1 || [...override.to].length !== 1 || from! >= to!
                || !Number.isInteger(override.left) || !Number.isInteger(override.right) || override.right < override.left) {
                throw new Error(`Invalid Unihex size override in font ${fontKey.toNamespacedString()}`);
            }
            return { ...override, from: from!, to: to! };
        });
    } catch (error) {
        console.warn(`Could not load Unihex file ${key.toNamespacedString()}`, error);
        return glyphs;
    }
    const file = await Caching.unihexCache.get(key.serialize(), () => parseUnihex(key));
    if (!file) return glyphs;
    let atlas = atlases.get(provider);
    if (!atlas) { atlas = new UnihexAtlas(); atlases.set(provider, atlas); }
    for (const character of characters) {
        const codepoint = character.codePointAt(0)!, index = file.indices[codepoint];
        if (index < 0) continue;
        const record = { rows: file.rows.subarray(index * GLYPH_HEIGHT, (index + 1) * GLYPH_HEIGHT),
            bitWidth: file.metrics[index * 3], left: file.metrics[index * 3 + 1], right: file.metrics[index * 3 + 2] };
        const override = overrides.find(range => codepoint >= range.from && codepoint <= range.to);
        if (override) { record.left = override.left; record.right = override.right; }
        const width = record.right - record.left + 1;
        let rendered: ReturnType<UnihexAtlas["draw"]> | undefined;
        const render = () => rendered ??= atlas!.draw(record);
        glyphs.set(character, {
            get image() { return render().image; },
            get x() { return render().x; },
            get y() { return render().y; },
            width, height: GLYPH_HEIGHT, scale: 0.5, ascent: 7, advance: Math.floor(width / 2) + 1,
            boldOffset: 0.5, shadowOffset: 0.5
        });
    }
    return glyphs;
}
