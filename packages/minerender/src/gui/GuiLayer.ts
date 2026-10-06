import type { AssetKey } from "../assets/AssetKey";

/** A texture layer in GUI pixels. Later layers draw above earlier layers. */
export interface GuiLayer {
    name?: string;
    texture: AssetKey | string;
    /** Source-image pixels: [x, y, width, height], measured from the top left. */
    crop?: [number, number, number, number];
    /** Top-left position; x grows right and y grows down. Defaults to [0, 0]. */
    position?: [number, number];
    /** Output width and height. Defaults to the crop or full image size. */
    size?: [number, number];
}
