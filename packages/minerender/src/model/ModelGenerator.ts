import { Model } from "./Model";
import type { BufferGeometry } from "three";
import type { ImageData } from "canvas";
import { BoxGeometry, PlaneGeometry } from "three";
import { UVMapper } from "../UVMapper";
import { ModelElement } from "./ModelElement";
import { CubeFace } from "../CubeFace";
import type { QuadArray, TripleArray } from "./Model";

export class ModelGenerator {

    public static readonly ITEM_LAYERS: string[] = ["layer0", "layer1", "layer2", "layer3", "layer4"];

    /**
     * Front and back faces plus one zero-thickness side face per run of texels that border a transparent texel,
     * like vanilla's ItemModelGenerator. Pass the pixels of a single (first) animation frame.
     */
    public static generateItemModel(imageData: Pick<ImageData, "width" | "height" | "data">, layer: string): ModelElement[] {
        const tintindex = this.ITEM_LAYERS.indexOf(layer);
        const texture = `#${layer}`;
        const mainElement: ModelElement = {
            from: [0,0,7.5],
            to: [16,16,8.5],
            faces: {
                "south": {
                    uv: [0,0,16,16],
                    texture,
                    tintindex
                },
                "north": {
                    uv: [16,0,0,16],
                    texture,
                    tintindex
                }
            },
            shade: true
        };
        const elements = [mainElement];

        const { width, height, data } = imageData;
        const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] !== 0;
        const sx = 16 / width;
        const sy = 16 / height;
        // Texel runs along a row (up/down faces) or a column (east/west faces) share one side face.
        const sides: [CubeFace, number, number][] = [[CubeFace.UP, 0, -1], [CubeFace.DOWN, 0, 1], [CubeFace.WEST, -1, 0], [CubeFace.EAST, 1, 0]];
        for (const [face, dx, dy] of sides) {
            const horizontal = dx === 0;
            const lines = horizontal ? height : width;
            const length = horizontal ? width : height;
            for (let line = 0; line < lines; line++) {
                for (let start = 0; start < length; start++) {
                    const exposed = (i: number) => horizontal
                        ? opaque(i, line) && !opaque(i, line + dy)
                        : opaque(line, i) && !opaque(line + dx, i);
                    if (!exposed(start)) continue;
                    let end = start + 1;
                    while (end < length && exposed(end)) end++;

                    let uv: QuadArray, from: TripleArray, to: TripleArray;
                    if (horizontal) {
                        const y = 16 - (line + (dy > 0 ? 1 : 0)) * sy;
                        uv = [start * sx, line * sy, end * sx, (line + 1) * sy];
                        from = [start * sx, y, 7.5];
                        to = [end * sx, y, 8.5];
                    } else {
                        const x = (line + (dx > 0 ? 1 : 0)) * sx;
                        uv = [line * sx, start * sy, (line + 1) * sx, end * sy];
                        from = [x, 16 - end * sy, 7.5];
                        to = [x, 16 - start * sy, 8.5];
                    }
                    elements.push({ from, to, faces: { [face]: { uv, texture, tintindex } }, shade: true });
                    start = end;
                }
            }
        }
        return elements;
    }

}
