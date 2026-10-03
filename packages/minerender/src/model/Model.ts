import { ModelElement } from "./ModelElement";
import { DisplayPosition } from "./DisplayPosition";
import { GuiLight } from "./GuiLight";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo } from "../image/ImageLoader";

export const ITEM_GENERATED = "item/generated";
export const BUILTIN_GENERATED = "builtin/generated";
export const BUILTIN_ENTITY = "builtin/entity";

export const DEFAULT_ELEMENTS: ModelElement[] = []

export interface Model extends MinecraftAsset {
    textures?: IModelTextures;
    parent?: string;
    display?: ModelDisplay;
    elements?: ModelElement[];
    hierarchy?: string[];
}

export interface BlockModel extends Model {
    textures?: BlockModelTextures;
    ambientocclusion?: boolean;
}

export interface ItemModel extends Model {
    textures?: ItemModelTextures;
    gui_light?: GuiLight;
}

export interface TextureAsset extends MinecraftAsset, ImageInfo {
}

export interface ModelDisplay {
    position?: DisplayPosition;
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
