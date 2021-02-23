import { BoxGeometry, BufferAttribute, Float32BufferAttribute, Vec2, Vector2 } from "three";
import { QuadArray } from "./model/Model";
import { ModelFaces } from "./model/ModelElement";
import { CUBE_FACES } from "./CubeFace";

// noinspection PointlessArithmeticExpressionJS
export class UVMapper {

    public static addCubeFaceUvToArray(array: number[], faceIndex: number, textureWidth: number, textureHeight: number, [x1, y1, x2, y2]: QuadArray) {
        // Flip from top-to-bottom coordinates to bottom-to-top ones
        y1 = textureHeight - y1;
        y2 = textureHeight - y2;

        const u1 = x1 / textureWidth;
        const v1 = y1 / textureHeight;
        const u2 = x2 / textureWidth;
        const v2 = y2 / textureHeight;

        array[((faceIndex + 0) * 2) + 0] = u1;
        array[((faceIndex + 0) * 2) + 1] = v1;

        array[((faceIndex + 1) * 2) + 0] = u2;
        array[((faceIndex + 1) * 2) + 1] = v1;

        array[((faceIndex + 2) * 2) + 0] = u1;
        array[((faceIndex + 2) * 2) + 1] = v2;

        array[((faceIndex + 3) * 2) + 0] = u2;
        array[((faceIndex + 3) * 2) + 1] = v2;
    }

    public static setCubeFaceUvAttribute(attributes: BufferAttribute, faceIndex: number, textureWidth: number, textureHeight: number, [x1, y1, x2, y2]: QuadArray) {
        // Flip from top-to-bottom coordinates to bottom-to-top ones
        y1 = textureHeight - y1;
        y2 = textureHeight - y2;

        const u1 = x1 / textureWidth;
        const v1 = y1 / textureHeight;
        const u2 = x2 / textureWidth;
        const v2 = y2 / textureHeight;

        attributes.setXY(faceIndex + 0, u1, v1);
        attributes.setXY(faceIndex + 1, u2, v1);
        attributes.setXY(faceIndex + 2, u1, v2);
        attributes.setXY(faceIndex + 3, u2, v2);
    }

    public static setCubeUvs(geometry: BoxGeometry, textureWidth: number, textureHeight: number, faces: ModelFaces) {
        const attributes = geometry.getAttribute("uv") as BufferAttribute;
        for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
            let faceName = CUBE_FACES[faceIndex];
            let face = faces[faceName];
            if (!face||!face.uv) continue;

            this.setCubeFaceUvAttribute(attributes, faceIndex * 4, textureWidth, textureHeight, face.uv);
        }
    }

    public static facesToUvArray(faces: ModelFaces, textureWidth: number, textureHeight: number): number[] {
        const array: number[] = [];
        for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
            let faceName = CUBE_FACES[faceIndex];
            let face = faces[faceName];
            console.log(face);
            if (!face||!face.uv) continue;

            this.addCubeFaceUvToArray(array, faceIndex * 4, textureWidth, textureHeight, face.uv);
        }
        return array;
    }

    public static facesToUv(faces: ModelFaces, textureWidth: number, textureHeight: number): Float32BufferAttribute {
        return new Float32BufferAttribute(this.facesToUvArray(faces, textureWidth, textureHeight), 2);
    }

}
