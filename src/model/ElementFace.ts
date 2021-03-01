import { QuadArray } from "./Model";

export interface ElementFace {
    uv: QuadArray;
    mappedUv?: QuadArray;
    texture: string;
    cullface: string;
    rotation: number;
    tintindex: number;
}
