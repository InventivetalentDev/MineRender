import { CompatCanvas, createCanvas } from "./CanvasCompat";

/** Copies the nontransparent bounds without resizing the source; empty images become one transparent pixel. */
export function trimCanvas(source: CompatCanvas): CompatCanvas {
    if (source.width === 0 || source.height === 0) return createCanvas(1, 1);

    const canvas = createCanvas(source.width, source.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) throw new Error("Image export requires a 2D canvas context");
    context.drawImage(source as HTMLCanvasElement, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }

    if (right < left) {
        canvas.width = canvas.height = 1;
        return canvas;
    }
    const width = right - left + 1, height = bottom - top + 1;
    const cropped = context.getImageData(left, top, width, height);
    canvas.width = width;
    canvas.height = height;
    context.putImageData(cropped, 0, 0);
    return canvas;
}
