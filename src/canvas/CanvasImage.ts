import { CompatCanvas, createCanvas } from "./CanvasCompat";

export class CanvasImage {

    readonly canvas: CompatCanvas;
    readonly context: CanvasRenderingContext2D;

    constructor(width: number, height: number);
    constructor(data: ImageData);
    constructor(dataOrWidth: ImageData | number, height?: number) {
        if (height) {
            this.canvas = createCanvas(dataOrWidth as number, height);
        } else {
            this.canvas = createCanvas((dataOrWidth as ImageData).width, (dataOrWidth as ImageData).height);
        }
        this.context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    }

    get width(): number {
        return this.canvas.width;
    }

    set width(width: number) {
        this.canvas.width = width;
    }

    get height(): number {
        return this.canvas.height;
    }

    set height(height: number) {
        this.canvas.height = height;
    }

    get dataUrl() {
        return this.toDataURL();
    }

    toDataURL(): string {
        return this.canvas.toDataURL();
    }

    getData(sx: number = 0, sy: number = 0, sw: number = this.width, sh: number = this.height): ImageData {
        return this.context.getImageData(sx, sy, sw, sh);
    }

    putData(data: ImageData, dx = 0, dy = 0, dirtyX = 0, dirtyY = 0, dirtyWidth=data.width,dirtyHeight=data.height): void {
        this.context.putImageData(data, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
    }

    test() {
    }


}
