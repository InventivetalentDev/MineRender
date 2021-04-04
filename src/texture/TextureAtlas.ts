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

    dispose() {
        this.image.dispose();
        Ticker.remove(this.ticker);
    }
}
