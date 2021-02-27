export class WrappedImage {

    constructor(readonly data: ImageData) {
    }

    get dataArray(): Uint8ClampedArray {
        return this.data.data;
    }

    get width(): number {
        return this.data.width;
    }

    get height(): number {
        return this.data.height;
    }

    get animated(): boolean {
        return this.height > this.width && this.height % this.width === 0;
    }

    get frameCount(): number {
        return this.height / this.width;
    }

}
