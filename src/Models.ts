import { ModelKey, serializeModelKey } from "./cache/CacheKey";
import { Model } from "./model/Model";
import { Caching } from "./cache/Caching";
import { Textures } from "./Textures";

export class Models {

    public static create(key: ModelKey): Model {
        //TODO
    }

     public static get(key: ModelKey): Model {
         const keyStr = serializeModelKey(key);
         return Caching.modelCache.get(keyStr, k=>{
             return Models.create(key);
         })!;
    }

}
