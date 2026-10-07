import { BufferGeometry, Float32BufferAttribute, PlaneGeometry } from "three";
import type { GuiSpriteScaling } from "../MinecraftTextureMeta";

/** Builds one centered mesh; explicit source-pixel crops always stretch. */
export function createGuiTextureGeometry(
    width: number, height: number, imageWidth: number, imageHeight: number,
    crop?: [number, number, number, number], scaling?: GuiSpriteScaling
): BufferGeometry {
    if (crop || !scaling || scaling.type === "stretch") {
        const [x, y, w, h] = crop ?? [0, 0, imageWidth, imageHeight];
        const geometry = new PlaneGeometry(width, height);
        const uv = geometry.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, (x + uv.getX(i) * w) / imageWidth,
                1 - (y + (1 - uv.getY(i)) * h) / imageHeight);
        }
        return geometry;
    }

    const sw = scaling.width, sh = scaling.height;
    if (![sw, sh].every(value => Number.isInteger(value) && value > 0)) {
        throw new Error("GUI sprite dimensions must be positive integers");
    }
    if (![width, height].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error("GUI output dimensions must be finite and nonnegative");
    }
    const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];
    function quad(x: number, y: number, w: number, h: number, u: number, v: number, uw: number, vh: number) {
        if (w <= 0 || h <= 0) return;
        const index = positions.length / 3;
        const left = x - width / 2, top = height / 2 - y;
        positions.push(left, top, 0, left + w, top, 0, left, top - h, 0, left + w, top - h, 0);
        // Metadata dimensions are logical GUI pixels, independent of the PNG resolution.
        uvs.push(u / sw, 1 - v / sh, (u + uw) / sw, 1 - v / sh,
            u / sw, 1 - (v + vh) / sh, (u + uw) / sw, 1 - (v + vh) / sh);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
        indices.push(index, index + 2, index + 1, index + 2, index + 3, index + 1);
    }
    function tile(x: number, y: number, w: number, h: number, u: number, v: number, tw: number, th: number) {
        for (let dy = 0; dy < h; dy += th) {
            for (let dx = 0; dx < w; dx += tw) {
                const cw = Math.min(tw, w - dx), ch = Math.min(th, h - dy);
                quad(x + dx, y + dy, cw, ch, u, v, cw, ch);
            }
        }
    }
    if (scaling.type === "tile") {
        tile(0, 0, width, height, 0, 0, sw, sh);
    } else {
        const border = typeof scaling.border === "number"
            ? { left: scaling.border, top: scaling.border, right: scaling.border, bottom: scaling.border }
            : scaling.border;
        if (!border || (typeof scaling.border === "number" && scaling.border <= 0)
            || ![border.left, border.top, border.right, border.bottom].every(value => Number.isInteger(value) && value >= 0)
            || border.left + border.right >= sw || border.top + border.bottom >= sh) {
            throw new Error("GUI nine-slice borders must be nonnegative integers with a nonempty center");
        }
        type Segment = [position: number, size: number, source: number, sourceSize: number];
        function segments(size: number, sourceSize: number, start: number, end: number): Segment[] {
            if (size === sourceSize) return [[0, size, 0, sourceSize]];
            // Vanilla crops border pixels when the output is too small to keep both borders.
            start = Math.min(start, Math.floor(size / 2));
            end = Math.min(end, Math.floor(size / 2));
            return [[0, start, 0, start], [start, size - start - end, start, sourceSize - start - end],
                [size - end, end, sourceSize - end, end]];
        }
        const columns = segments(width, sw, border.left, border.right);
        const rows = segments(height, sh, border.top, border.bottom);
        for (const [y, h, v, vh] of rows) {
            for (const [x, w, u, uw] of columns) {
                if (w <= 0 || h <= 0) continue;
                (scaling.stretch_inner ? quad : tile)(x, y, w, h, u, v, uw, vh);
            }
        }
    }
    return new BufferGeometry()
        .setAttribute("position", new Float32BufferAttribute(positions, 3))
        .setAttribute("normal", new Float32BufferAttribute(normals, 3))
        .setAttribute("uv", new Float32BufferAttribute(uvs, 2))
        .setIndex(indices);
}
