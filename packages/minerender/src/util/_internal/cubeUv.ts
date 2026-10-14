// Cube UV math lives outside UVMapper so SceneObject and skins can use it
// without importing the atlas and asset code.
import type { DoubleArray, QuadArray } from "../../model/Model";
import type { ModelFaces } from "../../model/ModelElement";
import { CUBE_FACES } from "../../CubeFace";

export const DEFAULT_UV: QuadArray = [0, 0, 16, 16];

export function makeUv(uvCoord: number, originalTextureSize: number, actualTextureSize: number): number {
    if (uvCoord === 0) return 0;
    return (actualTextureSize / originalTextureSize) * (uvCoord / originalTextureSize);
}

export function makeUvCoords([originalTextureWidth, originalTextureHeight]: DoubleArray, [actualTextureWidth, actualTextureHeight]: DoubleArray, [x1, y1, x2, y2]: QuadArray): QuadArray {
    // Flip from top-to-bottom coordinates to bottom-to-top ones
    y1 = originalTextureHeight - y1;
    y2 = originalTextureHeight - y2;

    const u1 = makeUv(x1, originalTextureWidth, actualTextureWidth);
    const v1 = makeUv(y1, originalTextureHeight, actualTextureHeight);
    const u2 = makeUv(x2, originalTextureWidth, actualTextureWidth);
    const v2 = makeUv(y2, originalTextureHeight, actualTextureHeight);

    return [u1, v1, u2, v2];
}

export function setFaceUvInArray(array: number[], faceIndex: number, uvs: QuadArray<DoubleArray>) {
    array[((faceIndex + 0) * 2) + 0] = uvs[0][0];
    array[((faceIndex + 0) * 2) + 1] = uvs[0][1];

    array[((faceIndex + 1) * 2) + 0] = uvs[1][0];
    array[((faceIndex + 1) * 2) + 1] = uvs[1][1];

    array[((faceIndex + 2) * 2) + 0] = uvs[2][0];
    array[((faceIndex + 2) * 2) + 1] = uvs[2][1];

    array[((faceIndex + 3) * 2) + 0] = uvs[3][0];
    array[((faceIndex + 3) * 2) + 1] = uvs[3][1];
}

export function setCubeFaceUvInArray(array: number[], faceIndex: number, [u1, v1, u2, v2]: QuadArray) {
    let a: DoubleArray = [u1, v1]; // top left
    let b: DoubleArray = [u2, v1]; // top right
    let c: DoubleArray = [u1, v2]; // bottom left
    let d: DoubleArray = [u2, v2]; // bottom right

    let uvs: QuadArray<DoubleArray> = [a, b, c, d];

    setFaceUvInArray(array, faceIndex, uvs);
}

export function addCubeFaceUvToArray(array: number[], faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray) {
    const uv = makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);
    setCubeFaceUvInArray(array, faceIndex, uv);
}

export function facesToUvArray(faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): number[] {
    const array: number[] = [];
    for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
        let faceName = CUBE_FACES[faceIndex];
        let face = faces[faceName];
        if (!face) continue;
        if (!face.uv) {
            face.uv = DEFAULT_UV;
        }

        addCubeFaceUvToArray(array, faceIndex * 4, originalTextureSize, actualTextureSize, face.uv);
    }
    return array;
}
