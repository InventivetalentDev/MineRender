import { DoubleArray, TripleArray } from "../model/Model";

export interface BedrockGeometry {
    visible_bounds_width: number;
    visible_bounds_height: number;
    visible_bounds_offset: TripleArray;
    texturewidth: number;
    textureheight: number;
    bones: BedrockBone[];
}

export interface BedrockBone {
    name: string;
    parent?: string;
    reset?: boolean;
    pivot?: TripleArray;
    cubes?: BedrockCube[];
    rotation?: TripleArray;
    neverRender?: boolean;
    locators?: {[k: string]:TripleArray};
}

export interface BedrockCube {
    origin: TripleArray;
    size: TripleArray;
    uv?: DoubleArray;
    inflate?: number;
}
