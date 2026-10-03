import type * as nodeCanvas from "canvas";
import { Env } from "../Env";

export type CompatImage = HTMLImageElement | nodeCanvas.Image;
export type CompatCanvas = HTMLCanvasElement | nodeCanvas.Canvas;

export function createImage(width?: number, height?: number): CompatImage {
    return Env.provider.createImage(width, height);
}

export function createCanvas(width: number, height: number): CompatCanvas {
    return Env.provider.createCanvas(width, height);
}
