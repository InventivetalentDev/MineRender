import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { Material, MeshBasicMaterial } from "three";
import { Textures } from "./Textures";
import { Caching } from "./cache/Caching";

export class Materials {

    public static readonly MISSING_TEXTURE = Materials.get({ texture: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAABlBMVEX/AP8AAACfphTyAAAADUlEQVQI12MIYFgAwgAG6AHhID0aOgAAAABJRU5ErkJggg==" } });

    public static create(key: MaterialKey): Material {
        //TODO: type from key
        return new MeshBasicMaterial({
            map: Textures.get(key.texture),

        });
        //TODO: params
    }

    public static get(key: MaterialKey): Material {
        const keyStr = serializeMaterialKey(key);
        return Caching.materialCache.get(keyStr, k => {
            return Materials.create(key);
        })!;
    }

}
