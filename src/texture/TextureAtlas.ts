import { CanvasImage } from "../canvas/CanvasImage";
import { DoubleArray, Model } from "../model/Model";
import { AnimatorFunction } from "../AnimatorFunction";
import Timeout = NodeJS.Timeout;
import { Disposable } from "../Disposable";
import { Ticker } from "../Ticker";

export class TextureAtlas implements Disposable {
    ticker?: number;

    constructor(
        readonly model: Model,
        readonly image: CanvasImage,
        readonly sizes: { [texture: string]: DoubleArray },
        readonly positions: { [texture: string]: DoubleArray },
        readonly hasAnimation: boolean,
        readonly animatorFunctions: { [p: string]: AnimatorFunction },
        readonly hasTransparency: boolean
    ) {
    }

    getData(texture: string): ImageData {
        const pos = this.positions[texture];
        const size = this.sizes[texture];
        return this.image.getData(pos[0], pos[1], size[0], size[1]);
    }

    dispose() {
        this.image.dispose();
        Ticker.remove(this.ticker);
    }
}
