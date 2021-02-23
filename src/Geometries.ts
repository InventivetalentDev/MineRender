import { BoxGeometry, BufferAttribute, Float32BufferAttribute } from "three";
import {  BoxGeometryKey, serializeBoxGeometryKey } from "./cache/CacheKey";
import { Caching } from "./cache/Caching";

export class Geometries {

    public static createBox(key: BoxGeometryKey): BoxGeometry {
        const geometry = new BoxGeometry(key.width, key.height, key.depth);
        geometry.computeBoundingBox();

        if (key.uv) {
            geometry.setAttribute("uv", new Float32BufferAttribute(key.uv, 2));
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

    public static getBox(key: BoxGeometryKey): BoxGeometry {
        const keyStr = serializeBoxGeometryKey(key)
        return Caching.boxGeometryCache.get(keyStr, k => {
            return Geometries.createBox(key);
        })!;
    }

}


