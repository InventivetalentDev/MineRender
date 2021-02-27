import { BoxGeometry, BufferAttribute, Float32BufferAttribute, Vec2, Vector2 } from "three";
import { DoubleArray, Model, QuadArray, TextureAsset } from "./model/Model";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { CUBE_FACES } from "./CubeFace";
import { ModelTextures } from "./ModelTextures";
import { Assets } from "./Assets";
import { Maybe } from "./util";
import { WrappedImage } from "./WrappedImage";
import { CanvasImage } from "./CanvasImage";

export const DEFAULT_UV: QuadArray = [0, 0, 16, 16];

// noinspection PointlessArithmeticExpressionJS
export class UVMapper {

    protected static makeUv(uvCoord: number, originalTextureSize: number, actualTextureSize: number): number {
        if (uvCoord === 0) return 0;
        return (actualTextureSize / originalTextureSize) * (uvCoord / originalTextureSize);
    }

    protected static makeUvCoords([originalTextureWidth, originalTextureHeight]: DoubleArray, [actualTextureWidth, actualTextureHeight]: DoubleArray, [x1, y1, x2, y2]: QuadArray): QuadArray {
        // Flip from top-to-bottom coordinates to bottom-to-top ones
        y1 = originalTextureHeight - y1;
        y2 = originalTextureHeight - y2;

        const u1 = this.makeUv(x1, originalTextureWidth, actualTextureWidth);
        const v1 = this.makeUv(y1, originalTextureHeight, actualTextureHeight);
        const u2 = this.makeUv(x2, originalTextureWidth, actualTextureWidth);
        const v2 = this.makeUv(y2, originalTextureHeight, actualTextureHeight);

        return [u1, v1, u2, v2];
    }

    public static addCubeFaceUvToArray(array: number[], faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray) {
        const [u1, v1, u2, v2] = this.makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);

        array[((faceIndex + 0) * 2) + 0] = u1;
        array[((faceIndex + 0) * 2) + 1] = v1;

        array[((faceIndex + 1) * 2) + 0] = u2;
        array[((faceIndex + 1) * 2) + 1] = v1;

        array[((faceIndex + 2) * 2) + 0] = u1;
        array[((faceIndex + 2) * 2) + 1] = v2;

        array[((faceIndex + 3) * 2) + 0] = u2;
        array[((faceIndex + 3) * 2) + 1] = v2;
    }

    public static setCubeFaceUvAttribute(attributes: BufferAttribute, faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray): void {
        const [u1, v1, u2, v2] = this.makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);

        attributes.setXY(faceIndex + 0, u1, v1);
        attributes.setXY(faceIndex + 1, u2, v1);
        attributes.setXY(faceIndex + 2, u1, v2);
        attributes.setXY(faceIndex + 3, u2, v2);
    }

    public static setCubeUvs(geometry: BoxGeometry, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, faces: ModelFaces): void {
        const attributes = geometry.getAttribute("uv") as BufferAttribute;
        for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
            let faceName = CUBE_FACES[faceIndex];
            let face = faces[faceName];
            if (!face) continue;
            if (!face.uv) {
                face.uv = DEFAULT_UV;
            }

            this.setCubeFaceUvAttribute(attributes, faceIndex * 4, originalTextureSize, actualTextureSize, face.uv);
        }
    }

    public static facesToUvArray(faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): number[] {
        const array: number[] = [];
        for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
            let faceName = CUBE_FACES[faceIndex];
            let face = faces[faceName];
            if (!face) continue;
            if (!face.uv) {
                face.uv = DEFAULT_UV;
            }

            this.addCubeFaceUvToArray(array, faceIndex * 4, originalTextureSize, actualTextureSize, face.uv);
        }
        return array;
    }

    public static facesToUv(faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): Float32BufferAttribute {
        return new Float32BufferAttribute(this.facesToUvArray(faces, originalTextureSize, actualTextureSize), 2);
    }

    public static async createAtlas(model: Model) {
        const textureMap: { [key: string]: Maybe<WrappedImage>; } = {};
        if (model.textures) {
            const promises: Promise<void>[] = [];
            for (let textureKey in model.textures) {
                let textureValue = model.textures[textureKey];
                promises.push(ModelTextures.get(Assets.parseAssetKey("textures", textureValue, model.key)).then(asset => {
                    textureMap[textureKey] = new WrappedImage(asset!);
                }));
            }
            await Promise.all(promises);
             const textureCount = promises.length;

             const sizes: { [texture: string]: DoubleArray; } = {};

            let maxWidth = 0;
            let maxHeight = 0;
            for (let textureKey in textureMap) {
                let texture = textureMap[textureKey];
                if(!texture) continue;
                sizes[textureKey] = [texture.width, texture.height];
                if (texture.width > maxWidth) {
                    maxWidth = texture.width;
                }
                if (texture.height > maxHeight) {
                    maxHeight = texture.height;
                }
            }

            const s = Math.sqrt(textureCount);
            const size = Math.ceil(s*maxWidth)

            const image = new CanvasImage(size, size);

            const positions: { [texture: string]: DoubleArray; } = {};


            let textureIndex = 0;
            for (let textureKey in textureMap) {
                let texture = textureMap[textureKey];
                if(!texture)continue;
                let x = Math.floor(textureIndex % maxWidth);
                let y = Math.floor(textureIndex / maxWidth);
                positions[textureKey] = [x, y];
                image.putData(texture.data, x, y);
            }
            //TODO

            if (model.elements) {
                for (let elementIndex = 0; elementIndex < model.elements.length; elementIndex++) {
                    let element = model.elements[elementIndex];
                    for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
                        let faceName = CUBE_FACES[faceIndex];
                        let face = element.faces[faceName];
                        if (!face) continue;


                    }
                }
            }
        }
    }

}
