import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { DoubleSide, FrontSide, Material, MeshBasicMaterial } from "three";
import { Textures } from "./Textures";
import { Caching } from "./cache/Caching";

export class Materials {

    public static readonly MISSING_TEXTURE = Materials.getImage({ texture: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC" } });

    public static createImage(key: MaterialKey): Material {
        //TODO: type from key
        const transparent = key.transparent || false;
        return new MeshBasicMaterial({
            map: Textures.getImage(key.texture),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.1
        });
        //TODO: params
    }

    public static createCanvas(canvas: HTMLCanvasElement): Material {
        //TODO
        return new MeshBasicMaterial({
            map: Textures.createCanvas(canvas),
            transparent: true
        })
    }

    public static getImage(key: MaterialKey): Material {
        const keyStr = serializeMaterialKey(key);
        return Caching.materialCache.get(keyStr, k => {
            return Materials.createImage(key);
        })!;
    }

}
