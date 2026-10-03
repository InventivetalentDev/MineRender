import localforage from "localforage";
import { Env, EnvProvider, ImageSizeInfo } from "../../Env";
import type { CompatCanvas, CompatImage } from "../../canvas/CanvasCompat";
import type { PersistentCache } from "../../cache/PersistentCache";
import { BrowserCache } from "./BrowserCache";
import { probeImageSize } from "./probeImageSize";

/**
 * {@link EnvProvider} backed by the DOM. Uses nothing outside of standard browser APIs and
 * localforage, so it stays free of Node polyfills.
 */
export class BrowserEnv implements EnvProvider {

    public readonly name = "browser";

    createCanvas(width: number, height: number): CompatCanvas {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    createImage(width?: number, height?: number): CompatImage {
        const image = document.createElement("img");
        image.crossOrigin = "anonymous";
        if (width) image.width = width;
        if (height) image.height = height;
        return image;
    }

    imageSize(data: Uint8Array): ImageSizeInfo {
        return probeImageSize(data);
    }

    openCache(name: string, version: number): PersistentCache {
        return new BrowserCache(localforage.createInstance({
            name: name,
            version: version
        }));
    }

}

export function registerBrowserEnv(): BrowserEnv {
    const env = new BrowserEnv();
    Env.register(env);
    return env;
}
