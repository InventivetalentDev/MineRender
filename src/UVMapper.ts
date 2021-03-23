import { BoxGeometry, BufferAttribute, Float32BufferAttribute, Vec2, Vector2, Vector4 } from "three";
import { DoubleArray, Model, QuadArray, TextureAsset } from "./model/Model";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { CUBE_FACES, CubeFace } from "./CubeFace";
import { ModelTextures } from "./model/ModelTextures";
import { Assets } from "./assets/Assets";
import { Maybe, toRadians } from "./util/util";
import { WrappedImage } from "./WrappedImage";
import { CanvasImage } from "./canvas/CanvasImage";
import { Mode } from "fs";
import { TextureAtlas } from "./texture/TextureAtlas";
import { AssetKey, serializeAssetKey } from "./cache/CacheKey";
import { Caching } from "./cache/Caching";
import { ImageLoader } from "./image/ImageLoader";
import { createImageData, ImageData } from "canvas";
import { SSAOPassOUTPUT } from "three/examples/jsm/postprocessing/SSAOPass";
import debug from "debug";
import { DEBUG_NAMESPACE } from "./util/debug";

const d = debug(`${ DEBUG_NAMESPACE }:UVMapper`);

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

    public static addCubeFaceUvToArray(array: number[], faceIndex: number, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray, originalCoords: QuadArray) {
        const uv = this.makeUvCoords(originalTextureSize, actualTextureSize, originalCoords);
        this.setCubeFaceUvInArray(array, faceIndex, uv);
    }

    public static setCubeFaceUvInArray(array: number[], faceIndex: number, [u1, v1, u2, v2]: QuadArray) {
        let a: DoubleArray = [u1, v1]; // top left
        let b: DoubleArray = [u2, v1]; // top right
        let c: DoubleArray = [u1, v2]; // bottom left
        let d: DoubleArray = [u2, v2]; // bottom right

        let uvs: QuadArray<DoubleArray> = [a, b, c, d];

        this.setFaceUvInArray(array, faceIndex, uvs);
    }

    public static setFaceUvInArrayV(array: number[], faceIndex: number, uvs: QuadArray<Vector2>) {
        array[((faceIndex + 0) * 2) + 0] = uvs[0].x;
        array[((faceIndex + 0) * 2) + 1] = uvs[0].y;

        array[((faceIndex + 1) * 2) + 0] = uvs[1].x;
        array[((faceIndex + 1) * 2) + 1] = uvs[1].y;

        array[((faceIndex + 2) * 2) + 0] = uvs[2].x;
        array[((faceIndex + 2) * 2) + 1] = uvs[2].y;

        array[((faceIndex + 3) * 2) + 0] = uvs[3].x;
        array[((faceIndex + 3) * 2) + 1] = uvs[3].y;
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

    protected static expandAndRotateMcUvs([u1, v1, u2, v2]: QuadArray, rotation?: number): QuadArray<Vector2> {
        let tl: Vector2 = new Vector2(u1, v1);// top left
        let tr: Vector2 = new Vector2(u2, v1);// top right
        let bl: Vector2 = new Vector2(u1, v2);// bottom left
        let br: Vector2 = new Vector2(u2, v2);// bottom right

        switch (rotation) {
            case 0:
            case 360:
            default:
                break;
            case 90:
                tl = new Vector2(u1, v2);
                tr = new Vector2(u1, v1);
                bl = new Vector2(u2, v2);
                br = new Vector2(u2, v1);
                break;
            case 180:
                tl = new Vector2(u2, v2);
                tr = new Vector2(u1, v2);
                bl = new Vector2(u2, v1);
                br = new Vector2(u1, v1);
                break;
            case 270:
                tl = new Vector2(u2, v1);
                tr = new Vector2(u2, v2);
                bl = new Vector2(u1, v1);
                br = new Vector2(u1, v2);
                break;
        }

        return [tl, tr, bl, br];
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
            d("Creating Atlas for %d textures", textureCount);
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

            const s = (Math.ceil(Math.sqrt(textureCount + 1))); // +1 for transparency
            const size = Math.ceil(s * maxWidth)
            d("Atlas size: %d", size);
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
            const atlasImageData = image.toDataURL();
            // console.log(atlasImageData);

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

                        let faceTexture = face.texture;
                        let texPosition;
                        let texSize;
                        if (faceTexture) {
                            faceTexture = faceTexture.substr(1); // remove #
                            texPosition = positions[faceTexture] || [0, 0];
                            texSize = sizes[faceTexture] || [16, 16];
                        }

                        let texPosV = new Vector2(texPosition[0], texPosition[1]);

                        const [tl, tr, bl, br] = this.expandAndRotateMcUvs(face.uv, face.rotation);

                        // move to atlas position
                        tl.add(texPosV);
                        tr.add(texPosV);
                        bl.add(texPosV);
                        br.add(texPosV);

                        // divide to 0-1
                        tl.divideScalar(size);
                        tr.divideScalar(size);
                        bl.divideScalar(size);
                        br.divideScalar(size);

                        // flip y coordinates
                        tl.y = 1 - tl.y;
                        tr.y = 1 - tr.y;
                        bl.y = 1 - bl.y;
                        br.y = 1 - br.y;

                        //TODO: figure out how uv lock works


                        let uvs: QuadArray<Vector2> = [tl, tr, bl, br];
                        // console.log("uvs", uvs);
                        this.setFaceUvInArrayV(uv, faceIndex * 4, uvs);
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
