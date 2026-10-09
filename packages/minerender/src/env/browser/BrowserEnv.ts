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
            // IndexedDB schema upgrades retain records; each cache generation needs its own database.
            name: name + version,
            version: version
        }));
    }

    createWorker(name: "section"): Worker | undefined {
        if (name !== "section" || typeof Worker === "undefined") return undefined;
        try {
            // Keep the literal URL so bundlers emit the worker file next to the entry.
            return new Worker(new URL("./section.worker.mjs", import.meta.url), { type: "module" });
        } catch {
            // No import.meta.url outside ESM, or a cross-origin module worker.
            return undefined;
        }
    }

}

/** Installs the browser provider. The browser package entry calls this automatically. */
export function registerBrowserEnv(): BrowserEnv {
    const env = new BrowserEnv();
    Env.register(env);
    return env;
}
