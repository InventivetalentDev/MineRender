import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { DoubleSide, FrontSide, Material, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial } from "three";
import { Textures } from "./texture/Textures";
import { Caching } from "./cache/Caching";
import { AssetKey } from "./assets/AssetKey";

export class Materials {

    public static readonly MISSING_TEXTURE = Materials.getImage({ texture: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC" } });

    public static createImage(key: MaterialKey): MeshBasicMaterial {
        //TODO: type from key
        const transparent = key.transparent || false;
        return new MeshBasicMaterial({
            map: Textures.getImage(key.texture),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.5
        });
        //TODO: params
    }


    public static createCanvas(canvas: HTMLCanvasElement, transparent: boolean = false, shade: boolean = false): Material {
        //TODO
        if (shade) {
            return new MeshStandardMaterial({
                map: Textures.createCanvas(canvas),
                transparent: transparent,
                side: transparent ? DoubleSide : FrontSide,
                alphaTest: 0.5,

            })
        }
        return new MeshBasicMaterial({
            map: Textures.createCanvas(canvas),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.5,

        })
    }

    public static getImage(key: MaterialKey): Material {
        const keyStr = serializeMaterialKey(key);
        return Caching.materialCache.get(keyStr, k => {
            return Materials.createImage(key);
        })!;
    }

}
