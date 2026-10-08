/** A canvas-backed image with dimensions and a context for reading pixel regions. */
export interface ExtractableImageData {
    readonly data: CanvasImageData;
    readonly width: number;
    readonly height: number;
}
