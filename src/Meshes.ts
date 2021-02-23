import { BoxGeometryKey, MeshKey, serializeBoxGeometryKey, serializeMeshKey, serializeTextureKey, TextureKey } from "./cache/CacheKey";
import { Mesh } from "three";
import { Geometries } from "./Geometries";
import { Materials } from "./Materials";
import { Caching } from "./cache/Caching";

export class Meshes {

    public static createBox(key: MeshKey): Mesh {
        return new Mesh(Geometries.getBox(key.geometry), Materials.get(key.material));
    }

    public static getBox(key: MeshKey): Mesh {
        const keyStr = serializeMeshKey(key);
        return Caching.boxMeshCache.get(keyStr, k=>{
            return Meshes.createBox(key);
        })!;
    }

}
