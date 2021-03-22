import * as nodeCanvas from "canvas";

export type CompatImage = HTMLImageElement | nodeCanvas.Image;
export type CompatCanvas = HTMLCanvasElement | nodeCanvas.Canvas;

export function createImage(width?: number, height?: number): CompatImage {
    let img;
    if (typeof document !== "undefined") {
        img = document.createElement('img') as HTMLImageElement;
        img.crossOrigin = "anonymous";
    } else {
        img = new nodeCanvas.Image();
    }
    if (width)
        img.width = width;
    if (height)
        img.height = height;

    return img;
}

export function createCanvas(width: number, height: number): CompatCanvas {
    let canvas;
    if (typeof document !== "undefined") {
        canvas = document.createElement('canvas') as HTMLCanvasElement;
    } else {
        canvas = nodeCanvas.createCanvas(width, height);
    }
    canvas.width = width;
    canvas.height = height;

    return canvas;
}
