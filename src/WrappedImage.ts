import { ImageData } from "canvas";
import { ImageInfo } from "./image/ImageLoader";
import { ExtractableImageData } from "./ExtractableImageData";

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

    get animated(): boolean {
        return this.height > this.width && this.height % this.width === 0;
    }

    get frameCount(): number {
        return this.height / this.width;
    }

    getFrameY(frame: number): number {
        return (this.height / this.frameCount) * Math.max(0, Math.min(this.frameCount, frame));
    }

    getSectionData(sx: number, sy: number, sw: number, sh: number): ImageData {
        return this.dta.data.getImageData(sx, sy, sw, sh);
    }

    getFrameSectionData(frame: number): ImageData {
        const y = this.getFrameY(frame);
        return this.getSectionData(0, y, this.width, this.width + y);
    }

}
