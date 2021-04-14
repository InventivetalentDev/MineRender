import { ModelElement } from "./ModelElement";
import { DisplayPosition } from "./DisplayPosition";
import { GuiLight } from "./GuiLight";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo } from "../image/ImageLoader";

export const DEFAULT_ELEMENTS: ModelElement[] = []

export interface Model extends MinecraftAsset {
    textures?: ModelTextures;
    parent?: string;
    display?: ModelDisplay;
    elements?: ModelElement[];
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

export interface ModelTextures {
    [variable: string]: string;
}

export interface BlockModelTextures extends ModelTextures {
    particle: string;
}

export interface ItemModelTextures extends BlockModelTextures {
    /*layerN: number*/
}

export type DoubleArray<T = number> = [T, T];
export type TripleArray<T = number> = [T, T, T];
export type QuadArray<T = number> = [T, T, T, T];
