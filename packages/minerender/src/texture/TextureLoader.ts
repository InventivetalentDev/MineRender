import { PixelFormat, RGBAFormat, Texture } from "three";
import { Caching } from "../cache/Caching";
import * as THREE from "three";
import { ImageLoader } from "../image/ImageLoader";
import { createCanvas } from "../canvas/CanvasCompat";
import type { CanvasRenderingContext2D } from "canvas";
import { Textures } from "./Textures";

export class TextureLoader {

    private static readonly failedTextures = new WeakSet<Texture>();

    /** Reports whether image loading failed, so cached textures can be retried. */
    public static hasFailed(texture: Texture): boolean {
        return this.failedTextures.has(texture);
    }

    protected static createTexture(): Texture {
        return new Texture();
    }

    public static loadInBackground(src: string, format: PixelFormat = RGBAFormat, rotation: number = 0): Texture {
        const texture = this.createTexture();
        texture.colorSpace = THREE.SRGBColorSpace;
        const image = ImageLoader.loadElement(src, () => {
            texture.needsUpdate = true;
        }, error => {
            this.failedTextures.add(texture);
            console.warn("Failed to load texture", src, error);
        });
        texture.image = image;
        texture.format = format;
        texture.rotation = rotation;

        return Textures.initTextureProps(texture);
    }

    public static load(src: string,format: PixelFormat = RGBAFormat, rotation: number = 0): Texture {
        const texture = new Texture();
        texture.colorSpace = THREE.SRGBColorSpace;
        ImageLoader.getData(src).then(image=>{
            texture.image = image;
            texture.needsUpdate = true;
        }).catch(error => {
            this.failedTextures.add(texture);
            console.warn("Failed to load texture", src, error);
        });
        texture.format = format;
        texture.rotation = rotation;

        return Textures.initTextureProps(texture);
    }


}
