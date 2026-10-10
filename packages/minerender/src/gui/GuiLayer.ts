import type { AssetKey } from "../assets/AssetKey";
import type { ItemModelContext } from "../assets/Models";
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

/** A texture layer for {@link MineRenderScene.addGui}. Uncropped textures use their `.mcmeta` scaling rules. */
export interface GuiTextureLayer extends GuiLayerLayout {
    texture: AssetKey | string;
    /** Source-image pixels: [x, y, width, height], measured from the top left. Crops ignore sprite scaling. */
    crop?: [number, number, number, number];
}

/** An item preview in a 16×16 GUI slot by default, with optional tint overrides. */
export interface GuiItemLayer extends GuiLayerLayout {
    /** Model key, such as minecraft:item/stone; uses the model's GUI display pose. */
    item: AssetKey | string;
    /** Supplied item state, count label, and damage bar. Count zero leaves an empty slot; models always use the GUI display context. */
    context?: Omit<ItemModelContext, "displayContext">;
    /** Draw count labels and durability bars. Defaults to true. */
    decorations?: boolean;
    /** sRGB 0xRRGGBB colors by face tint index, overriding the item's automatic preview colors. */
    tints?: Record<number, number>;
}

/** A bitmap-text layer. Set font, wrapping, and style directly on the layer object. */
export interface GuiTextLayer extends GuiLayerLayout, GuiTextOptions {
    text: GuiText;
}
