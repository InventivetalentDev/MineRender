import type { ImageData } from "canvas";
import type { ExtractableImageData } from "./ExtractableImageData";

/** Provides pixel and frame access to a canvas-backed image. Simple frame helpers assume a vertical strip of squares. */
export class WrappedImage {

    private alpha?: { transparency: boolean; translucency: boolean };

    constructor(readonly dta: ExtractableImageData) {
    }

    get data(): ImageData {
        return this.getSectionData(0, 0, this.width, this.height);
    }

    get dataArray(): Uint8ClampedArray {
        return this.data.data;
    }

    get width(): number {
        return this.dta.width;
    }

    get height(): number {
        return this.dta.height;
    }

    get hasTransparency(): boolean {
        return this.getAlpha().transparency;
    }

    /** Whether any pixel has partial alpha. Binary alpha renders as cutout, not blended. */
    get hasTranslucency(): boolean {
        return this.getAlpha().translucency;
    }

    private getAlpha(): { transparency: boolean; translucency: boolean } {
        if (this.alpha) return this.alpha;
        const data = this.data.data;
        let transparency = false;
        let translucency = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                transparency = true;
                if (data[i] > 0) {
                    translucency = true;
                    break;
                }
            }
        }
        return this.alpha = { transparency, translucency };
    }

    /** Whether the dimensions form a vertical strip of square frames, without consulting `.mcmeta`. */
    get animated(): boolean {
        return this.height > this.width && this.height % this.width === 0;
    }

    get frameWidth(): number {
        return this.width;
    }

    get frameHeight(): number {
        return this.animated ? this.width : this.height;
    }

    get frameCount(): number {
        return this.height / this.frameHeight;
    }

    getFrameY(frame: number): number {
        return this.frameHeight * Math.max(0, Math.min(this.frameCount - 1, frame));
    }

    getSectionData(sx: number, sy: number, sw: number, sh: number): ImageData {
        return this.dta.data.getImageData(sx, sy, sw, sh);
    }

    getPixel(x: number, y: number): Uint8ClampedArray {
        return this.dta.data.getImageData(x,y,1,1).data;
    }

    getFrameSectionData(frame: number): ImageData {
        const y = this.getFrameY(frame);
        return this.getSectionData(0, y, this.frameWidth, this.frameHeight);
    }

}
