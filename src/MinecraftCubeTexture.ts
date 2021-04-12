import { CanvasImage } from "./canvas/CanvasImage";
import { UVMapper } from "./UVMapper";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import { DoubleArray, QuadArray } from "./model/Model";

export class MinecraftCubeTexture {

    constructor(
        readonly image: CanvasImage,
        readonly u: number, readonly v: number,
        readonly width: number, readonly height: number, readonly length: number
    ) {
    }

    getUvEast(): QuadArray<DoubleArray> {
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getUvWest(): QuadArray<DoubleArray> {
//TODO
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getUvUp(): QuadArray<DoubleArray> {
//TODO
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getUvDown(): QuadArray<DoubleArray> {
//TODO
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getUvSouth(): QuadArray<DoubleArray> {
//TODO
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getUvNorth(): QuadArray<DoubleArray> {
//TODO
        return [
            [this.u,this.v+this.height],
            [this.u+this.width,this.v+this.height],
            [this.u, this.v],
            [this.u+this.width, this.v]
        ]
    }

    getFaceUv(face: CubeFace): QuadArray<DoubleArray> {
        switch (face) {
            case CubeFace.EAST:
                return this.getUvEast();
            case CubeFace.WEST:
                return this.getUvWest();
            case CubeFace.UP:
                return this.getUvUp();
            case CubeFace.DOWN:
                return this.getUvDown();
            case CubeFace.SOUTH:
                return this.getUvSouth();
            case CubeFace.NORTH:
                return this.getUvNorth();
        }
    }

    toUvArray(): number[] {
        const uv: number[] = [];
        for (let i = 0; i < CUBE_FACES.length; i++) {
            UVMapper.setFaceUvInArray(uv, i * 4, this.getFaceUv(CUBE_FACES[i]));
        }
        return uv;
    }


}
