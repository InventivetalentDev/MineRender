import { ModelElement } from "./ModelElement";
import { DisplayPosition } from "./DisplayPosition";
import { GuiLight } from "./GuiLight";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo } from "../image/ImageLoader";

export const ITEM_GENERATED = "item/generated";
export const BUILTIN_GENERATED = "builtin/generated";
export const BUILTIN_ENTITY = "builtin/entity";

export const DEFAULT_ELEMENTS: ModelElement[] = []

/** A Java model definition. {@link Models.getMerged} resolves its parent, textures, and elements. */
export interface Model extends MinecraftAsset {
    textures?: IModelTextures;
    parent?: string;
    display?: Partial<Record<DisplayPosition, ModelDisplay>>;
    elements?: ModelElement[];
    hierarchy?: string[];
}

/** Java block-model data, including the ambient-occlusion flag. */
export interface BlockModel extends Model {
    textures?: BlockModelTextures;
    ambientocclusion?: boolean;
}

/** Item preview data, including GUI lighting, tint sources, and supported special renderers. */
export interface ItemModel extends Model {
    textures?: ItemModelTextures;
    gui_light?: GuiLight;
    special?: SpecialItemRenderer;
    tints?: ItemTintSource[];
    /** Stack-component snapshot with namespaced IDs, used to resolve this item's tint sources. */
    components?: Record<string, unknown>;
    /** Ordered composite children, each with its own textures, display pose, and tint sources. */
    parts?: ItemModel[];
}

/** An sRGB packed `0xRRGGBB` value or an RGB triple with components from 0 to 1. */
export type ItemTintColor = number | TripleArray;

/** A vanilla item color source. Missing component values and unsupported gameplay state use the declared default. */
export type ItemTintSource =
    | { type: "constant" | "minecraft:constant"; value: ItemTintColor }
    | { type: "grass" | "minecraft:grass"; temperature: number; downfall: number }
    | { type: "dye" | "minecraft:dye" | "potion" | "minecraft:potion" | "map_color" | "minecraft:map_color"
        | "firework" | "minecraft:firework" | "team" | "minecraft:team"; default: ItemTintColor }
    | { type: "custom_model_data" | "minecraft:custom_model_data"; index?: number; default: ItemTintColor };

/** Supported item definitions that draw entity geometry instead of ordinary model elements. */
export type SpecialItemRenderer =
    | { type: "chest" | "minecraft:chest"; texture: string; openness?: number }
    | { type: "shulker_box" | "minecraft:shulker_box"; texture: string; openness?: number;
        orientation?: "down" | "up" | "north" | "south" | "west" | "east" }
    | { type: "bed" | "minecraft:bed"; texture: string }
    | { type: "head" | "minecraft:head"; kind: string; texture?: string; animation?: number };

export interface TextureAsset extends MinecraftAsset, ImageInfo {
}

/** A model display pose: translation in model units, rotation in degrees, and scale factors. */
export interface ModelDisplay {
    translation?: TripleArray;
    rotation?: TripleArray;
    scale?: TripleArray;
}

export interface IModelTextures {
    [variable: string]: string;
}

export interface BlockModelTextures extends IModelTextures {
    particle: string;
}

export interface ItemModelTextures extends BlockModelTextures {
    /*layerN: number*/
}

export type DoubleArray<T = number> = [T, T];
export type TripleArray<T = number> = [T, T, T];
export type QuadArray<T = number> = [T, T, T, T];

export function isDoubleArray(obj: any): obj is DoubleArray {
    return Array.isArray(obj) && obj.length === 2;
}

export function isTripleArray(obj: any): obj is TripleArray {
    return Array.isArray(obj) && obj.length === 3;
}

export function isQuadArray(obj: any): obj is QuadArray {
    return Array.isArray(obj) && obj.length === 4;
}
