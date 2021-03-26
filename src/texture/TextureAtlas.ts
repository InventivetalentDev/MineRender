import { CanvasImage } from "../canvas/CanvasImage";
import { DoubleArray, Model } from "../model/Model";
import { AnimatorFunction } from "../AnimatorFunction";

export interface TextureAtlas {
    model: Model;
    image: CanvasImage;
    sizes: { [texture: string]: DoubleArray; };
    positions: { [texture: string]: DoubleArray; };

    hasAnimation: boolean;
    animatorFunctions: { [texture: string]: AnimatorFunction; };
}
