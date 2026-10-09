import type { ImageData } from "canvas";
import type { ExtractableImageData } from "./ExtractableImageData";

/** Provides pixel and frame access to a canvas-backed image. Simple frame helpers assume a vertical strip of squares. */
export class WrappedImage {

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
        const data = this.data.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 255) {
                return true;
            }
        }
        return false;
    }

    /** Whether any pixel has partial alpha. Binary alpha renders as cutout, not blended. */
    get hasTranslucency(): boolean {
        const data = this.data.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0 && data[i + 3] < 255) {
                return true;
            }
        }
        return false;
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
