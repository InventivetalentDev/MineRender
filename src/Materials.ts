import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { DoubleSide, FrontSide, Material, MeshBasicMaterial } from "three";
import { Textures } from "./Textures";
import { Caching } from "./cache/Caching";

export class Materials {

    public static readonly MISSING_TEXTURE = Materials.get({ texture: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC" } });

    public static create(key: MaterialKey): Material {
        //TODO: type from key
        const transparent = key.transparent || false;
        return new MeshBasicMaterial({
            map: Textures.get(key.texture),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.1
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
