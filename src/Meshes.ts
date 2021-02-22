import { BoxGeometryCacheKey, MeshCacheKey } from "./cache/CacheKey";
import { Mesh } from "three";
import { Geometries } from "./Geometries";
import { Materials } from "./Materials";
import { Caching } from "./cache/Caching";

export class Meshes {

    public static createBox(key: MeshCacheKey): Mesh {
        return new Mesh(Geometries.getBox(key), Materials.get(key));
    }

    public static getBox(key: MeshCacheKey): Mesh {
        return Caching.boxMeshCache.get(key)!;
    }

}
