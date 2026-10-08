import { PixelFormat } from "three";
import { md5 } from "../util/util";

export type CacheKey = string;

/** Source URL used to identify cached image bytes and pixels. */
export interface RawImageKey {
    src: string;
}

export function serializeImageKey(key: RawImageKey): string {
    return md5(key.src);
}

// export function parseImageKey(key: string): RawImageKey {
//     return {
//         src: base64decode(key)
//     };
// }

///

/** Box dimensions in scene units and optional normalized UVs in Three.js face order. */
export interface BoxGeometryKey {
    width: number;
    height: number;
    depth: number;
    uv?: number[];
}

export function serializeBoxGeometryKey(key: BoxGeometryKey): string {
    return md5([key.width, key.height, key.depth, key.uv?.join(":")].join("_"));
}

// export function parseBoxGeometryKey(key: string): BoxGeometryKey {
//     let [width, height, depth, uvS] = base64decode(key).split("_");
//     let uv = uvS.split(":").map(s => +s);
//     return {
//         width: +width,
//         height: +height,
//         depth: +depth,
//         uv
//     }
// }

///

/** Settings passed to {@link Textures.getImage}. Texture rotation uses radians. */
export interface TextureKey extends RawImageKey {
    format?: PixelFormat;
    rotation?: number;
}

export function serializeTextureKey(key: TextureKey): string {
    return md5([key.src, key.format, key.rotation].join("$"));
}

// export function parseTextureGeometryKey(key: string): TextureKey {
//     let [src, format] = base64decode(key).split("$");
//     return {
//         src,
//         format: +format
//     }
// }

///

/** Texture and transparency settings passed to {@link Materials.getImage}. */
export interface MaterialKey {
    texture: TextureKey;
    transparent?: boolean;
}

export function serializeMaterialKey(key: MaterialKey): string {
    return md5([serializeTextureKey(key.texture), key.transparent].join("~"));
}


///

/** Geometry and material settings passed to {@link Meshes.createBox} or {@link Meshes.getBox}. */
export interface MeshKey {
    geometry: BoxGeometryKey;
    material: MaterialKey;
}

export function serializeMeshKey(key: MeshKey): string {
    return md5([serializeBoxGeometryKey(key.geometry), serializeMaterialKey(key.material)].join("#"));
}


///



