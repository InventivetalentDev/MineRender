import type { ImageData } from "canvas";
import { CanvasImage } from "../canvas/CanvasImage";
import { DoubleArray, Model } from "../model/Model";
import { AnimatorFunction } from "../AnimatorFunction";
import { Disposable } from "../Disposable";
import { Ticker } from "../Ticker";

/** A model's combined texture canvas, per-texture rectangles, and shared animation subscriptions. */
export class TextureAtlas implements Disposable {
    ticker?: number;
    private readonly subscribers = new Set<() => void>();

    constructor(
        readonly model: Model,
        readonly image: CanvasImage,
        readonly sizes: { [texture: string]: DoubleArray },
        readonly positions: { [texture: string]: DoubleArray },
        readonly hasAnimation: boolean,
        readonly animatorFunctions: { [p: string]: AnimatorFunction },
        readonly hasTransparency: boolean,
        readonly hasTranslucency: boolean = false
    ) {
    }

    /** Calls subscribers when an animation frame changes; unused atlases do not tick. */
    subscribe(callback: () => void): () => void {
        if (!this.hasAnimation) return () => {};
        this.subscribers.add(callback);
        if (this.ticker === undefined) {
            this.ticker = Ticker.add(() => {
                let changed = false;
                for (const animate of Object.values(this.animatorFunctions)) {
                    if (animate() !== false) changed = true;
                }
                if (changed) for (const subscriber of this.subscribers) subscriber();
            });
        }
        return () => {
            this.subscribers.delete(callback);
            if (!this.subscribers.size) {
                Ticker.remove(this.ticker);
                this.ticker = undefined;
            }
        };
    }

    /** Copies pixels for a texture variable from its current atlas rectangle. */
    getData(texture: string): ImageData {
        const pos = this.positions[texture];
        const size = this.sizes[texture];
        return this.image.getData(pos[0], pos[1], size[0], size[1]);
    }

    dispose() {
        this.image.dispose();
        Ticker.remove(this.ticker);
        this.ticker = undefined;
        this.subscribers.clear();
    }
}
