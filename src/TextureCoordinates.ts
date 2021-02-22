import { CubeFace } from "./CubeFace";

export interface TextureCoordinates {
    [key: string]: CubeTextureCoordinates;
}

export type CubeTextureCoordinates = Record<CubeFace, TextureCoordinate>;


export interface TextureCoordinate {
    /** x-pos (from left) **/
    x: number;
    /** y-pos (from top) **/ //TODO: convert y+h to UV space (bottom)
    y: number;
    /** width **/
    w: number;
    /** height **/
    h: number;
    /** flip texture horizontally **/
    fx?: boolean;
    /** flip texture vertically **/
    fy?: boolean;
}
