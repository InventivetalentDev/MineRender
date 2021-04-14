import { CanvasImage } from "./canvas/CanvasImage";
import { UVMapper } from "./UVMapper";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import { DoubleArray, QuadArray } from "./model/Model";
import { ExtractableImageData } from "./ExtractableImageData";

export class MinecraftCubeTexture {

    constructor(
        readonly u: number, readonly v: number,
        readonly width: number, readonly height: number
    ) {
    }

    get mappedU() {
        return this.u/this.width;
    }

    get mappedV() {
        return this.v/this.height;
    }

    getUvEast(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getUvWest(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getUvUp(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getUvDown(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getUvSouth(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getUvNorth(w: number, h: number, l: number): QuadArray<DoubleArray> {
//TODO
        return [
            [this.mappedU,this.mappedV+h],
            [this.mappedU+w,this.mappedV+h],
            [this.mappedU, this.mappedV],
            [this.mappedU+w, this.mappedV]
        ]
    }

    getFaceUv(face: CubeFace, w: number, h: number, l: number): QuadArray<DoubleArray> {
        switch (face) {
            case CubeFace.EAST:
                return this.getUvEast(w,h,l);
            case CubeFace.WEST:
                return this.getUvWest(w,h,l);
            case CubeFace.UP:
                return this.getUvUp(w,h,l);
            case CubeFace.DOWN:
                return this.getUvDown(w,h,l);
            case CubeFace.SOUTH:
                return this.getUvSouth(w,h,l);
            case CubeFace.NORTH:
                return this.getUvNorth(w,h,l);
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
