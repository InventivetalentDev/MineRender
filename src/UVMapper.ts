import { BoxGeometry, BufferAttribute, Float32BufferAttribute, Vec2, Vector2 } from "three";
import { DoubleArray, Model, QuadArray, TextureAsset } from "./model/Model";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import { ModelTextures } from "./ModelTextures";
import { Assets } from "./Assets";
import { Maybe, toRadians } from "./util";
import { WrappedImage } from "./WrappedImage";
import { CanvasImage } from "./CanvasImage";
import { Mode } from "fs";
import { TextureAtlas } from "./TextureAtlas";
import { AssetKey, serializeAssetKey } from "./cache/CacheKey";
import { Caching } from "./cache/Caching";
import { ImageLoader } from "./image/ImageLoader";
import { createImageData, ImageData } from "canvas";

export const DEFAULT_UV: QuadArray = [0, 0, 16, 16];
const X = 0;
const Y = 1;
const Z = 2;

/*
 * - Minecraft UVs are from the top-left to bottom-right
 * - three.js UVs are from the bottom-left to top-right
 * - canvas coordinates are from the top-left to bottom-right
 */

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

    //
    // public static rotateUv(/*uv*/[u1, v1, u2, v2]: QuadArray, degrees: number): QuadArray {
    //     switch (degrees) {
    //         case 90:
    //         case -270:
    //             return [u1, v2, u2, v1];
    //         case 180:
    //         case -180:
    //             return [u2, v2, u1, v1];
    //         case 270:
    //         case -90:
    //             return [u2, v1, u1, v2];
    //         case 0:
    //         case 360:
    //         default:
    //             // don't do anything
    //             break;
    //     }
    //     return [u1, v1, u2, v2];
    // }

    public static rotateSingleUv([u, v]: DoubleArray, [px, py]: DoubleArray, radians: number): DoubleArray {
        const sin = Math.sin(radians);
        const cos = Math.cos(radians);

        u -= px;
        v -= py;

        const uc = u;
        const vc = v;

        u = cos * uc - sin * vc;
        v = cos * vc + sin * uc;

        u += px;
        v += py;

        // return [parseFloat(u.toFixed(8)), parseFloat(v.toFixed(8))];
        return [u, v];
    }

    public static rotateAllUvs(uvs: QuadArray<DoubleArray>, pivot: DoubleArray, radians: number): QuadArray<DoubleArray> {
        console.log("rotating", uvs, "around", pivot, "by", radians, "rad");
        for (let i = 0; i < uvs.length; i++) {
            uvs[i] = this.rotateSingleUv(uvs[i], pivot, radians);
        }
        return uvs;
    }

    public static rotateUvs(uvs: QuadArray, degrees: number): QuadArray {
        switch (degrees) {
            case 90:
            case -270:
                return [
                    uvs[1],
                    uvs[2],
                    uvs[3],
                    uvs[0]
                ]
            case 180:
            case -180:
                return [
                    uvs[2],
                    uvs[3],
                    uvs[0],
                    uvs[1]
                ]
            case 270:
            case -90:
                return [
                    uvs[3],
                    uvs[0],
                    uvs[1],
                    uvs[2]
                ]
            case 0:
            case 360:
            default:
                // don't do anything
                break;
        }
        return uvs;
    }

    public static addCubeFaceUvToArray(array: number[], faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray) {
        const uv = this.makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);
        this.setCubeFaceUvInArray(array, faceIndex, uv);
    }

    public static setCubeFaceUvInArray(array: number[], faceIndex: number, [u1, v1, u2, v2]: QuadArray, rotationDegrees: number = 0, rotationPivot?: DoubleArray) {
        let a: DoubleArray = [u1, v1]; // top left
        let b: DoubleArray = [u2, v1]; // top right
        let c: DoubleArray = [u1, v2]; // bottom left
        let d: DoubleArray = [u2, v2]; // bottom right

        let uvs: QuadArray<DoubleArray> = [a, b, c, d];
        if (rotationDegrees && rotationDegrees !== 0) {
            // if (!rotationPivot) {
            //     rotationPivot = [(u1 + u2) / 2, (v1 + v2) / 2];
            // }
            // uvs = this.rotateAllUvs(uvs, rotationPivot, toRadians(rotationDegrees));
            // console.log("rotated uvs", uvs);
        }

        this.setFaceUvInArray(array, faceIndex, uvs);
    }

    public static setWrappedCubeFaceUvInArray(array: number[], faceIndex: number, wrappedUv: MinecraftFaceUV, atlasSize: number, texPos: DoubleArray) {
        let uvs: QuadArray<DoubleArray> = [
            [wrappedUv.getU(0) / atlasSize+texPos[0], wrappedUv.getV(0) / atlasSize+texPos[1]],
            [wrappedUv.getU(1) / atlasSize+texPos[0], wrappedUv.getV(1) / atlasSize+texPos[1]],
            [wrappedUv.getU(2) / atlasSize+texPos[0], wrappedUv.getV(2) / atlasSize+texPos[1]],
            [wrappedUv.getU(3) / atlasSize+texPos[0], wrappedUv.getV(3) / atlasSize+texPos[1]],
        ];

        this.setFaceUvInArray(array, faceIndex, uvs);
    }

    public static setFaceUvInArray(array: number[], faceIndex: number, uvs: QuadArray<DoubleArray>) {
        array[((faceIndex + 0) * 2) + 0] = uvs[0][0];
        array[((faceIndex + 0) * 2) + 1] = uvs[0][1];

        array[((faceIndex + 1) * 2) + 0] = uvs[1][0];
        array[((faceIndex + 1) * 2) + 1] = uvs[1][1];

        array[((faceIndex + 2) * 2) + 0] = uvs[2][0];
        array[((faceIndex + 2) * 2) + 1] = uvs[2][1];

        array[((faceIndex + 3) * 2) + 0] = uvs[3][0];
        array[((faceIndex + 3) * 2) + 1] = uvs[3][1];
    }

    public static setCubeFaceUvAttribute(attributes: BufferAttribute, faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray): void {
        const uv = this.makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);
        this.setCubeFaceUvInAttribute(attributes, faceIndex, uv);
    }

    public static setCubeFaceUvInAttribute(attributes: BufferAttribute, faceIndex: number, [u1, v1, u2, v2]: QuadArray) {
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

    public static async getAtlas(model: Model): Promise<Maybe<TextureAtlas>> {
        const keyStr = serializeAssetKey(model.key!);
        return Caching.modelTextureAtlasCache.get(keyStr, k => {
            return this.createAtlas(model);
        })
    }

    public static fillMissingTextureKeys<T>(textures: ModelTextures, target: { [k: string]: T }): { [k: string]: T } {
        for (let faceName of CUBE_FACES) {
            let v = textures[faceName];
            if (v && v.startsWith("#")) {
                target[faceName] = target[v.substr(1)];
            }
        }
        return target;
    }

    // https://yeleha.co/3qlboGS
    protected static getFallbackUv(element: ModelElement, faceName: CubeFace): QuadArray {
        switch (faceName) {
            case CubeFace.DOWN:
                return [element.from[X], 16 - element.to[Z], element.to[X], 16 - element.from[Z]];
            case CubeFace.UP:
                return [element.from[X], element.from[Z], element.to[X], element.to[Z]];
            case CubeFace.NORTH:
            default:
                return [16 - element.to[X], 16 - element.to[Y], 16 - element.from[X], 16 - element.from[Y]];
            case CubeFace.SOUTH:
                return [element.from[X], 16 - element.to[Y], element.to[X], 16 - element.from[Y]];
            case CubeFace.WEST:
                return [element.from[Z], 16 - element.to[Y], element.to[Z], 16 - element.from[Y]];
            case CubeFace.EAST:
                return [16 - element.to[Z], 16 - element.to[Y], 16 - element.from[Z], 16 - element.from[Y]];
        }
    }

    public static async createAtlas(originalModel: Model): Promise<Maybe<TextureAtlas>> {
        const textureMap: { [key: string]: Maybe<WrappedImage>; } = {};
        const model = { ...originalModel };
        if (model.textures) {
            const promises: Promise<void>[] = [];
            const uniqueTextureNames: string[] = []; // TODO: make these actually unique
            const textureReferences: { [k: string]: string; } = {};
            for (let textureKey in model.textures) {
                let textureValue = model.textures[textureKey];
                if (textureValue.startsWith("#")) {
                    textureReferences[textureKey] = textureValue.substr(1);
                } else {
                    uniqueTextureNames.push(textureKey);
                    promises.push(ModelTextures.get(Assets.parseAssetKey("textures", textureValue, model.key)).then(asset => {
                        textureMap[textureKey] = new WrappedImage(asset!);
                    }));
                }
            }
            await Promise.all(promises);
            const textureCount = uniqueTextureNames.length;
            // console.log(textureCount + " textures")
            // console.log(model.textures)

            this.fillMissingTextureKeys(model.textures, textureMap);

            const sizes: { [texture: string]: DoubleArray; } = {};

            // Find largest texture dimensions
            let maxWidth = 0;
            let maxHeight = 0;
            for (let textureKey of uniqueTextureNames) {
                let texture = textureMap[textureKey];
                if (!texture) continue;
                sizes[textureKey] = [texture.width, texture.height];
                if (texture.width > maxWidth) {
                    maxWidth = texture.width;
                }
                if (texture.height > maxHeight) {
                    maxHeight = texture.height;
                }
            }
            this.fillMissingTextureKeys(model.textures, sizes);

            // console.log(sizes);

            const s = (Math.ceil(Math.sqrt(textureCount) / 2) * 2);
            // console.log(s)
            const size = Math.ceil(s * maxWidth)
            // console.log("size: " + size);
            const squaredSize = size * size;

            const missing = await ImageLoader.getData("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC");
            const empty = await ImageLoader.getData("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAA5JREFUKM9jGAWjgAIAAAJAAAFSSwuTAAAAAElFTkSuQmCC");
            //TODO: add transparent texture and use as default uv

            // Create image
            const image = new CanvasImage(size, size);
            image.putData(missing, 0, 0);
            image.putData(empty, 0, 0, 0, 0, maxWidth, maxWidth);

            const positions: { [texture: string]: DoubleArray; } = {};

            // Draw all textures onto a single image
            let tx = 1; // start one over to leave room for the transparent space
            let ty = 0;
            for (let textureIndex = 0; textureIndex < uniqueTextureNames.length; textureIndex++) {
                let textureKey = uniqueTextureNames[textureIndex];
                let texture = textureMap[textureKey];
                // console.log(tx);
                // console.log(ty);
                let x = tx * maxWidth;
                let y = ty * maxWidth;
                // console.log(x);
                // console.log(y);
                if (texture) {
                    positions[textureKey] = [x, y];
                    // console.log(Buffer.from(texture.dataArray).toString("base64"))
                    // console.log(`drawing at ${ x } ${ y }`)
                    image.putData(texture.data, x, y, 0, 0, maxWidth, maxWidth);
                    // console.log(image.toDataURL())
                    //TODO: only first frame for animated textures
                }
                tx++;
                if (tx >= s) {
                    tx = 0;
                    ty++;
                }
            }
            // let textureIndex = 0;
            // for (let textureKey of uniqueTextureNames) {
            //     let texture = textureMap[textureKey];
            //     if (!texture) continue;
            //     let y = Math.floor(textureIndex % s) * maxWidth;
            //     let x = Math.floor(textureIndex / s) * maxWidth;
            //     console.log(x);
            //     console.log(y);
            //     console.log(Buffer.from(texture.dataArray).toString("base64"))
            //     positions[textureKey] = [x, y];
            //     image.putData(texture.data, x, y, 0, 0, maxWidth, maxWidth);
            //     //TODO: only first frame for animated textures
            //     textureIndex++;
            // }
            const atlasImageData = image.toDataURL();
            console.log(atlasImageData);

            this.fillMissingTextureKeys(model.textures, positions);

            // console.log(positions);

            // Adjust UV positions
            if (model.elements) {
                for (let elementIndex = 0; elementIndex < model.elements.length; elementIndex++) {
                    let element = model.elements[elementIndex];
                    let uv: number[] = [];
                    // Set default uvs to missing texture
                    for (let i = 0; i < CUBE_FACES.length; i++) {
                        this.setCubeFaceUvInArray(uv, i * 4, [0, 0, 8 / size, 8 / size])
                    }
                    for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
                        let faceName = CUBE_FACES[faceIndex];
                        // console.log(faceName)
                        let face = element.faces[faceName];
                        if (!face) {
                            // set uv transparent
                            this.setCubeFaceUvInArray(uv, faceIndex * 4, [0, 1, 8 / size, (size - 8) / size])
                            continue;
                        }
                        if (!face.uv) {
                            face.uv = this.getFallbackUv(element, faceName);
                        }
                        const wrappedUv = new MinecraftFaceUV(face.uv, face.rotation);
                        console.log("wrappedUV", wrappedUv)

                        let faceTexture = face.texture;
                        let texPosition;
                        let texSize;
                        if (faceTexture) {
                            faceTexture = faceTexture.substr(1); // remove #
                            texPosition = positions[faceTexture] || [0, 0];
                            texSize = sizes[faceTexture] || [16, 16];
                        }

                        let tempUv: QuadArray = [...face.uv];
                        if (face.rotation&&face.rotation!==0) {
                            tempUv = this.rotateUvs(tempUv, face.rotation);
                        }
                        // console.log("rotated tempUv",tempUv);

                        // convert uv to atlas dimensions
                        // let fuv: QuadArray = [
                        //     wrappedUv.getU(0) / size,
                        //     wrappedUv.getV(0) / size,
                        //     wrappedUv.getU(2) / size,
                        //     wrappedUv.getV(2) / size
                        // ];
                        let fuv: QuadArray = [
                            tempUv[0] / size,
                            tempUv[1] / size,
                            tempUv[2] / size,
                            tempUv[3] / size
                        ];

                        let mappedTexPos = [
                            texPosition[0] / size,
                            texPosition[1] / size
                        ];

                        // move it to the updated atlas position
                        if (texPosition) {
                            fuv[0] += mappedTexPos[0];
                            fuv[1] += mappedTexPos[1];
                            fuv[2] += mappedTexPos[0];
                            fuv[3] += mappedTexPos[1];
                        }

                        // flip on y axis
                        fuv[1] = 1 - fuv[1];
                        fuv[3] = 1 - fuv[3];

                        face.mappedUv = fuv;

                        this.setCubeFaceUvInArray(uv, faceIndex * 4, fuv, face.rotation);
                        // this.setWrappedCubeFaceUvInArray(uv, faceIndex, wrappedUv, size, mappedTexPos);
                    }

                    // console.log(element);
                    // console.log(uv);
                    element.mappedUv = uv;
                }
            }


            return {
                model,
                image,
                sizes,
                positions
            };
        }
        return undefined;
    }

}

// Based on net.minecraft.client.renderer.block.model.BlockFaceUV
export class MinecraftFaceUV {

    constructor(readonly uv: QuadArray = [0, 0, 16, 16], readonly rotation: number = 0) {
    }

    getU(index: number): number {
        const shiftedIndex = this.getShiftedIndex(index);
        return this.uv[shiftedIndex !== 0 && index !== 1 ? 2 : 0];
    }

    getV(index: number): number {
        const shiftedIndex = this.getShiftedIndex(index);
        return this.uv[shiftedIndex !== 0 && index !== 3 ? 3 : 1];
    }

    protected getShiftedIndex(index: number): number {
        return (index + this.rotation / 90) % 40;
    }

    protected getReverseIndex(index: number): number {
        return (index + 4 - this.rotation / 90) % 4;
    }

}
