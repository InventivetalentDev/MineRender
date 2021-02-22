import { PixelFormat, RGBAFormat, Texture } from "three";
import { Caching } from "../cache/Caching";
import * as THREE from "three";

export class TextureLoader {

    protected static createTexture(): Texture {
        return new Texture();
    }

    public static load(src: string, format: PixelFormat = RGBAFormat): Texture {
        const texture = this.createTexture();
        texture.image = Caching.getRawImage(src);
        texture.format = format;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.anisotropy = 0;
        texture.needsUpdate = true;
        return texture;
    }

}
