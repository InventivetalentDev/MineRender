import type { CompatCanvas, CompatImage } from "./canvas/CanvasCompat";
import type { PersistentCache } from "./cache/PersistentCache";

/**
 * Dimensions probed from raw, still-encoded image bytes.
 * Mirrors the subset of `image-size`'s result that MineRender actually uses.
 */
export interface ImageSizeInfo {
    width?: number;
    height?: number;
    type?: string;
}

/**
 * Everything MineRender needs from the platform it is running on.
 *
 * This is the seam between the browser and Node builds: core code only ever talks to the
 * registered provider, so nothing outside of `src/env/node/` may reference a Node-only module
 * (`canvas`, `node-persist`, `image-size`, `fs`, …). Keeping that rule is what allows the browser
 * bundle to be built without Node polyfills.
 */
export interface EnvProvider {

    readonly name: string;

    createCanvas(width: number, height: number): CompatCanvas;

    createImage(width?: number, height?: number): CompatImage;

    /** Read width/height out of encoded image bytes without fully decoding them. */
    imageSize(data: Uint8Array): ImageSizeInfo;

    openCache(name: string, version: number): PersistentCache;

}

/**
 * Registry holding the active {@link EnvProvider}.
 *
 * The `minerender` package entries register one for you — importing the library through its
 * `exports` map gets you the browser provider in bundlers and the Node provider under Node.
 * Only call {@link Env.register} directly if you are embedding MineRender in an exotic host.
 */
export class Env {

    private static _provider: EnvProvider | undefined;

    public static register(provider: EnvProvider): void {
        this._provider = provider;
    }

    public static get registered(): boolean {
        return typeof this._provider !== "undefined";
    }

    public static get provider(): EnvProvider {
        const provider = this._provider;
        if (!provider) {
            throw new Error(
                "MineRender has no environment provider registered. Import the package itself " +
                "(\"minerender\") rather than a file inside dist/, or register one yourself via " +
                "Env.register(...)."
            );
        }
        return provider;
    }

}
