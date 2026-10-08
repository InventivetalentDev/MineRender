import { QuadArray } from "./Model";

/** Texture and culling settings for one cuboid face. Java model UVs use Minecraft's 0–16 texture space. */
export interface ElementFace {
    uv: QuadArray;
    mappedUv?: QuadArray;
    texture: string;
    cullface?: string;
    rotation?: number;
    tintindex?: number;
}
