import { BoxGeometry, BufferAttribute, Float32BufferAttribute } from "three";
import {  BoxGeometryKey, serializeBoxGeometryKey } from "./cache/CacheKey";
import { Caching } from "./cache/Caching";

/**
 * Each face's UV rectangle (min u, min v, max u, max v) on its four vertices, which `Materials.boundUvs` keeps samples inside.
 * Model atlases replace it with bounds inset to texel centres (`UVMapper.setAtlasUvBounds`).
 */
function faceUvBounds(uv: number[]): Float32BufferAttribute {
    const bounds = new Float32Array(uv.length * 2);
    for (let face = 0; face < uv.length / 8; face++) {
        const us = [0, 1, 2, 3].map(corner => uv[(face * 4 + corner) * 2]);
        const vs = [0, 1, 2, 3].map(corner => uv[(face * 4 + corner) * 2 + 1]);
        for (let corner = 0; corner < 4; corner++) {
            bounds.set([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)], (face * 4 + corner) * 4);
        }
    }
    return new Float32BufferAttribute(bounds, 4);
}

/** Creates box geometry with optional face UVs and caches it by dimensions and UV values. */
export class Geometries {

    public static createBox(key: BoxGeometryKey): BoxGeometry {
        const geometry = new BoxGeometry(key.width, key.height, key.depth);
        geometry.computeBoundingBox();

        if (key.uv) {
            geometry.setAttribute("uv", new Float32BufferAttribute(key.uv, 2));
            geometry.setAttribute("uvBounds", faceUvBounds(key.uv));
        }



        // if (key.coordinates) { // Create UV mappings
        //     const w = key.texWidth || 16;
        //     const h = key.texHeight || 16;
        //
        //     const index = geometry.getIndex();
        //     const uvAttributes = geometry.getAttribute("uv");
        //
        //     const faceUvs = [];
        //     const faceNames = Object.values(CubeFace);
        //     let j = 0;
        //     for (let i = 0; i < faceNames.length; i++) {
        //         const faceName = faceNames[i];
        //         const face = key.coordinates[faceName];
        //
        //         console.log(faceName);
        //         console.log(face)
        //
        //         const tx1 = face.x / w;
        //         const ty1 =  (face.y / h);
        //         const tx2 = (face.x + face.w) / w;
        //         const ty2 =  ((face.y + face.h) / h);
        //
        //
        //         uvAttributes.setXY(j + 0, tx1, ty1);
        //
        //         uvAttributes.setXY(j + 2, tx2, ty2);
        //
        //         // faceUvs[i] = [
        //         //     new THREE.Vector2(tx1, ty2),
        //         //     new THREE.Vector2(tx1, ty1),
        //         //     new THREE.Vector2(tx2, ty1),
        //         //     new THREE.Vector2(tx2, ty2)
        //         // ];
        //         //
        //         // const flipX = face.fx;
        //         // const flipY = face.fy;
        //         //
        //         // let temp;
        //         // if (flipY) {
        //         //     temp = faceUvs[i].slice(0);
        //         //     faceUvs[i][0] = temp[2];
        //         //     faceUvs[i][1] = temp[3];
        //         //     faceUvs[i][2] = temp[0];
        //         //     faceUvs[i][3] = temp[1]
        //         // }
        //         // if (flipX) {
        //         //     temp = faceUvs[i].slice(0);
        //         //     faceUvs[i][0] = temp[3];
        //         //     faceUvs[i][1] = temp[2];
        //         //     faceUvs[i][2] = temp[1];
        //         //     faceUvs[i][3] = temp[0]
        //         // }
        //
        //
        //
        //         j+=4;
        //     }
        //
        //
        //     for (let i = 0; i < faceUvs.length; i++) {
        //         // uvAttributes.array[j] = [faceUvs[i][0], faceUvs[i][1], faceUvs[i][3]];
        //         // uvAttributes.array[j + 1] = [faceUvs[i][1], faceUvs[i][2], faceUvs[i][3]];
        //         // j += 2;
        //     }
        //     uvAttributes.needsUpdate = true;
        //
        //
        // }


        return geometry;
    }

    /** Returns shared geometry. Use {@link createBox} when the caller needs to modify or dispose it independently. */
    public static getBox(key: BoxGeometryKey): BoxGeometry {
        const keyStr = serializeBoxGeometryKey(key)
        return Caching.boxGeometryCache.get(keyStr, k => {
            return Geometries.createBox(key);
        })!;
    }

}


