import type { AssetKey } from "../assets/AssetKey";
import type { GuiText, GuiTextOptions } from "./GuiText";

/** GUI layers use pixel coordinates. Later layers draw above earlier layers. */
export type GuiLayer = GuiTextureLayer | GuiItemLayer | GuiTextLayer;

interface GuiLayerLayout {
    name?: string;
    /** Top-left position; x grows right and y grows down. Defaults to [0, 0]. */
    position?: [number, number];
    /** Output size; defaults to native texture/text dimensions, and [16, 16] for items. */
    size?: [number, number];
}

export interface GuiTextureLayer extends GuiLayerLayout {
    texture: AssetKey | string;
    /** Source-image pixels: [x, y, width, height], measured from the top left. Crops ignore sprite scaling. */
    crop?: [number, number, number, number];
}

export interface GuiItemLayer extends GuiLayerLayout {
    /** Model key, such as minecraft:item/stone; uses the model's GUI display pose. */
    item: AssetKey | string;
    /** sRGB 0xRRGGBB colors by face tint index; omitted indices stay white. */
    tints?: Record<number, number>;
}

export interface GuiTextLayer extends GuiLayerLayout, GuiTextOptions {
    text: GuiText;
}
