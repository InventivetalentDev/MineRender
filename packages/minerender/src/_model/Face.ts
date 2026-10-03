import { DoubleArray, QuadArray } from "../model/Model";

export interface Face {
    uv: QuadArray;
    mappedUv?: QuadArray;
    texture: string;
}
