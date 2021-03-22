import { CanvasImage } from "../canvas/CanvasImage";
import { DoubleArray, Model } from "../model/Model";

export interface TextureAtlas {
    model: Model;
    image: CanvasImage;
    sizes: { [texture: string]: DoubleArray; };
    positions: { [texture: string]: DoubleArray; };
}
