import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { AssetContext } from "../assets/AssetContext";
import type { AssetKey } from "../assets/AssetKey";
import type { BitmapGlyph } from "../assets/Fonts";
import type { CompatCanvas } from "../canvas/CanvasCompat";

/** Text appearance set on a GUI text layer or overridden by an individual text run. */
export interface GuiTextStyle {
    /** sRGB 0xRRGGBB; defaults to white. */
    color?: number;
    bold?: boolean;
    italic?: boolean;
}

/** A text segment with optional style overrides within {@link GuiText}. */
export interface GuiTextRun extends GuiTextStyle {
    text: string;
}

/** Literal text, or styled runs. Newlines are preserved. */
export type GuiText = string | readonly GuiTextRun[];

/** Text layout settings set on a GUI text layer or passed to {@link layoutGuiText}. */
export interface GuiTextOptions extends GuiTextStyle {
    /** Asset configuration used to load and measure the font. */
    assets?: AssetContext;
    /** Font resource ID; defaults to minecraft:default. */
    font?: AssetKey | string;
    /** Draws a one-pixel shadow; defaults to true. */
    shadow?: boolean;
    /** Wrap width in GUI pixels. Long words break at glyph boundaries. */
    maxWidth?: number;
    /** Distance between line origins; defaults to 9 GUI pixels. */
    lineHeight?: number;
}

/** One measured glyph and its position in GUI pixels, produced by {@link layoutGuiText}. */
export interface PositionedGuiGlyph {
    character: string;
    glyph?: BitmapGlyph;
    x: number;
    y: number;
    advance: number;
    style: Required<GuiTextStyle>;
}

/** Measured glyphs, line widths, and overall dimensions in GUI pixels. */
export interface GuiTextLayout {
    glyphs: PositionedGuiGlyph[];
    lineWidths: number[];
    width: number;
    height: number;
}

/** Measures and wraps text using the same glyph advances used for rendering. */
export async function layoutGuiText(text: GuiText, options: GuiTextOptions = {}): Promise<GuiTextLayout> {
    const maxWidth = options.maxWidth ?? Infinity, lineHeight = options.lineHeight ?? 9;
    if (!(maxWidth > 0) || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        throw new Error("Text wrap width and line height must be positive");
    }
    const assets = options.assets ?? AssetContext.for(typeof options.font === "object" ? options.font : undefined);
    const font = await assets.fonts.get(options.font);
    const runs = typeof text === "string" ? [{ text }] : text;
    const glyphs: PositionedGuiGlyph[] = [], lineWidths: number[] = [];
    let line: PositionedGuiGlyph[] = [], width = 0;
    let trailingNewline = false;
    const finishLine = (entries: PositionedGuiGlyph[]) => {
        let x = 0;
        for (const entry of entries) {
            glyphs.push({ ...entry, x, y: lineWidths.length * lineHeight });
            x += entry.advance;
        }
        lineWidths.push(x);
    };
    for (const run of runs) {
        const style = { color: run.color ?? options.color ?? 0xffffff,
            bold: run.bold ?? options.bold ?? false, italic: run.italic ?? options.italic ?? false };
        for (const character of run.text.replace(/\r\n?/g, "\n")) {
            trailingNewline = character === "\n";
            if (character === "\n") {
                finishLine(line); line = []; width = 0;
                continue;
            }
            const glyph = font.glyphs.get(character);
            const advance = (glyph?.advance ?? 6) + (style.bold ? 1 : 0);
            line.push({ character, glyph, advance, style, x: 0, y: 0 });
            width += advance;
            while (width > maxWidth && line.length > 1) {
                let space = -1;
                for (let i = 0; i < line.length; i++) if (line[i].character === " ") space = i;
                const split = space >= 0 ? space : line.length - 1;
                if (split > 0) finishLine(line.slice(0, split));
                line = line.slice(split + (space >= 0 ? 1 : 0));
                width = line.reduce((sum, entry) => sum + entry.advance, 0);
            }
        }
    }
    if (line.length || !lineWidths.length || trailingNewline) finishLine(line);
    return { glyphs, lineWidths, width: Math.max(0, ...lineWidths), height: lineWidths.length * lineHeight };
}

/** Creates glyph batches in painter order. Unsupported characters use an outlined missing glyph. */
export function createGuiTextGeometry(layout: GuiTextLayout, shadow = true): { image?: CompatCanvas; geometry: BufferGeometry }[] {
    interface Batch { image?: CompatCanvas; positions: number[]; uvs: number[]; colors: number[]; indices: number[]; }
    const batches: Batch[] = [];
    for (const isShadow of shadow ? [true, false] : [false]) {
        let batch: Batch | undefined;
        for (const entry of layout.glyphs) {
            const { glyph, style } = entry;
            if (glyph && !glyph.image) continue;
            if (!batch || batch.image !== glyph?.image) {
                batch = { image: glyph?.image, positions: [], uvs: [], colors: [], indices: [] };
                batches.push(batch);
            }
            const color = new Color(isShadow ? (style.color & 0xfcfcfc) >> 2 : style.color);
            const offset = isShadow ? 1 : 0;
            const top = glyph ? 7 - glyph.ascent : 0;
            const height = glyph ? glyph.height * glyph.scale : 8;
            const width = glyph ? glyph.width * glyph.scale : 5;
            const shear = (y: number) => style.italic ? 1 - 0.25 * y : 0;
            const quad = (left: number, upper: number, right: number, lower: number, boldOffset: number) => {
                const base = batch!.positions.length / 3;
                const x = entry.x + offset + boldOffset, y = entry.y + offset;
                batch!.positions.push(x + left + shear(upper), -y - upper, 0, x + right + shear(upper), -y - upper, 0,
                    x + left + shear(lower), -y - lower, 0, x + right + shear(lower), -y - lower, 0);
                const u0 = glyph ? glyph.x / glyph.image!.width : 0;
                const u1 = glyph ? (glyph.x + glyph.width) / glyph.image!.width : 1;
                const v0 = glyph ? 1 - glyph.y / glyph.image!.height : 1;
                const v1 = glyph ? 1 - (glyph.y + glyph.height) / glyph.image!.height : 0;
                batch!.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                for (let i = 0; i < 4; i++) batch!.colors.push(color.r, color.g, color.b);
                batch!.indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
            };
            for (const boldOffset of style.bold ? [0, 1] : [0]) {
                if (glyph) quad(0, top, width, top + height, boldOffset);
                else {
                    quad(0, 0, 5, 1, boldOffset); quad(0, 7, 5, 8, boldOffset);
                    quad(0, 1, 1, 7, boldOffset); quad(4, 1, 5, 7, boldOffset);
                }
            }
        }
    }
    return batches.map(({ image, positions, uvs, colors, indices }) => ({ image, geometry: new BufferGeometry()
        .setAttribute("position", new Float32BufferAttribute(positions, 3))
        .setAttribute("uv", new Float32BufferAttribute(uvs, 2))
        .setAttribute("color", new Float32BufferAttribute(colors, 3))
        .setIndex(indices) }));
}
