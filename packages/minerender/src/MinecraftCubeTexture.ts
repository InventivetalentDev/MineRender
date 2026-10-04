import { UVMapper } from "./UVMapper";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import type { DoubleArray, QuadArray } from "./model/Model";

/** Vanilla Minecraft cube UVs in Three.js BoxGeometry face and vertex order. */
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
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
        ];
    }

    getUvWest(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l), this.mapH(this.v + l)],
            [this.mapW(this.u), this.mapH(this.v + l)],
        ];
    }

    getUvUp(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v)],
            [this.mapW(this.u + l + w + w), this.mapH(this.v)],
        ];
    }

    getUvDown(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u + l), this.mapH(this.v)],
            [this.mapW(this.u + l + w), this.mapH(this.v)],
            [this.mapW(this.u + l), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
        ];
    }

    getUvSouth(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u + l + w + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l + w + l), this.mapH(this.v + l)],
        ];
    }

    getUvNorth(w: number, h: number, l: number): QuadArray<DoubleArray> {
        return [
            [this.mapW(this.u + l + w), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l), this.mapH(this.v + l + h)],
            [this.mapW(this.u + l + w), this.mapH(this.v + l)],
            [this.mapW(this.u + l), this.mapH(this.v + l)],
        ];
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

    toUvArray(w: number, h: number, l: number, mirror: boolean = false): number[] {
        const uv: number[] = [];
        for (let i = 0; i < CUBE_FACES.length; i++) {
            // Mirroring swaps east/west faces and reverses U within every face.
            const face = mirror && i < 2 ? CUBE_FACES[1 - i] : CUBE_FACES[i];
            const corners = this.getFaceUv(face, w, h, l);
            UVMapper.setFaceUvInArray(uv, i * 4, mirror ? [corners[1], corners[0], corners[3], corners[2]] : corners);
        }
        return uv;
    }

}
