import { ModelElement } from "./ModelElement";
import { DisplayPosition } from "./DisplayPosition";
import { GuiLight } from "./GuiLight";
import { MinecraftAsset } from "../MinecraftAsset";
import { AssetKey } from "../cache/CacheKey";
import { ImageInfo } from "../image/ImageLoader";

export interface BlockModel extends Model{
    textures?: BlockModelTextures;
    ambientocclusion?: boolean;
}

export interface ItemModel extends Model {
    textures?: ItemModelTextures;
    gui_light?: GuiLight;
}

export interface Model extends MinecraftAsset {
    textures?: ModelTextures;
    parent?: string;
    display?: ModelDisplay;
    elements?: ModelElement[];
}

export interface TextureAsset extends ImageInfo, MinecraftAsset {
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

export type DoubleArray = [number, number];
export type TripleArray = [number, number, number];
export type QuadArray = [number, number, number, number];
