import type * as nodeCanvas from "canvas";
import { Env } from "../Env";

export type CompatImage = HTMLImageElement | nodeCanvas.Image;
export type CompatCanvas = HTMLCanvasElement | nodeCanvas.Canvas;

/** Creates an image through the active environment provider. Dimensions are in pixels. */
export function createImage(width?: number, height?: number): CompatImage {
    return Env.provider.createImage(width, height);
}

/** Creates a browser or Node canvas through the active environment provider, sized in pixels. */
export function createCanvas(width: number, height: number): CompatCanvas {
    return Env.provider.createCanvas(width, height);
}
