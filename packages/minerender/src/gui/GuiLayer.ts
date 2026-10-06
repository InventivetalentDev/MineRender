import type { AssetKey } from "../assets/AssetKey";

/** GUI layers use pixel coordinates. Later layers draw above earlier layers. */
export type GuiLayer = GuiTextureLayer | GuiItemLayer;

interface GuiLayerLayout {
    name?: string;
    /** Top-left position; x grows right and y grows down. Defaults to [0, 0]. */
    position?: [number, number];
    /** Output width and height; defaults to the texture crop size or [16, 16] for items. */
    size?: [number, number];
}

export interface GuiTextureLayer extends GuiLayerLayout {
    texture: AssetKey | string;
    /** Source-image pixels: [x, y, width, height], measured from the top left. */
    crop?: [number, number, number, number];
}

export interface GuiItemLayer extends GuiLayerLayout {
    /** Model key, such as minecraft:item/stone; uses the model's GUI display pose. */
    item: AssetKey | string;
    /** sRGB 0xRRGGBB colors by face tint index; omitted indices stay white. */
    tints?: Record<number, number>;
}
