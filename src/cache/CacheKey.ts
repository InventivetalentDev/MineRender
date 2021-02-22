import { PixelFormat } from "three";
import { CubeTextureCoordinates } from "../TextureCoordinates";

export type CacheKey = string;

export function serializeImageKey(src: string): string {
    return src;
}

export function parseImageKey(key: string): string {
    return key;
}
