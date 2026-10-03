import { CanvasImage } from "./canvas/CanvasImage";
import { UVMapper } from "./UVMapper";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import { DoubleArray, QuadArray } from "./model/Model";
import { ExtractableImageData } from "./ExtractableImageData";

/**
 *          down  up
 *  east    north    west    south
 *
 *  bottom-left to top-right
 *  [bl, br, tl, tr]
 */
export class MinecraftCubeTexture {

    constructor(
        readonly u: number, readonly v: number,
        readonly width: number, readonly height: number
    ) {
    }


    protected mapW(x: number) {
        return x / this.width;
    }

    protected mapH(x: number) {
        return 1 - (x / this.height);
    }

    getUvEast(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u), this.mapH(this.v + l)],
            [this.mapW(this.u + l), this.mapH(this.v + l)],
        ]
    }

    getUvWest(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mapW(this.u + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l)],
        ]
    }

    getUvUp(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v)],
            [this.mapW(this.u + l + w + w), this.mapH(this.v)],
        ]
    }

    getUvDown(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mapW(this.u + l), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l), this.mapH(this.v)],
            [this.mapW(this.u + l+w), this.mapH(this.v)],
        ]
    }

    getUvSouth(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w + l + w), this.mapH(this.v + l)],
        ]
    }

    getUvNorth(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mapW(this.u + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
        ]
    }

    getFaceUv(face: CubeFace, w: number, h: number, l: number): QuadArray<DoubleArray> {
        switch (face) {
            case CubeFace.EAST:
                return this.getUvEast(w, h, l);
            case CubeFace.WEST:
                return this.getUvWest(w, h, l);
            case CubeFace.UP:
                return this.getUvUp(w, h, l);
            case CubeFace.DOWN:
                return this.getUvDown(w, h, l);
            case CubeFace.SOUTH:
                return this.getUvSouth(w, h, l);
            case CubeFace.NORTH:
                return this.getUvNorth(w, h, l);
        }
    }

    toUvArray(w: number, h: number, l: number): number[] {
        const uv: number[] = [];
        for (let i = 0; i < CUBE_FACES.length; i++) {
            UVMapper.setFaceUvInArray(uv, i * 4, this.getFaceUv(CUBE_FACES[i], w, h, l));
        }
        return uv;
    }


}
