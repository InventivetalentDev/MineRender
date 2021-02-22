import { MaterialCacheKey } from "./cache/CacheKey";
import { Material, MeshBasicMaterial } from "three";
import { Textures } from "./Textures";
import { Caching } from "./cache/Caching";

export class Materials {

    public static create(key: MaterialCacheKey): Material {
        //TODO: type from key
        return new MeshBasicMaterial({
            map: Textures.get(key)
        });
        //TODO: params
    }

    public static get(key: MaterialCacheKey): Material {
        return Caching.materialCache.get(key)!;
    }

}
