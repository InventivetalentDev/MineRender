import { Env, EnvProvider, ImageSizeInfo } from "../../Env";
import type { CompatCanvas, CompatImage } from "../../canvas/CanvasCompat";
import type { PersistentCache } from "../../cache/PersistentCache";
import { logger } from "../../util/log";
import { BrowserCache } from "./BrowserCache";
import { probeImageSize } from "./probeImageSize";

const log = logger("BrowserEnv");

/** Settings for {@link BrowserEnv} and {@link registerBrowserEnv}. */
export interface BrowserEnvOptions {
    /**
     * Section worker script, as a URL, or a function that creates the worker.
     * Set it when the bundle has no `import.meta.url`, such as the script-tag build: serve
     * `minerender/section.worker` from the page's origin and pass its URL.
     * Register before creating a world; the worker starts on the first section build.
     */
    sectionWorker?: string | URL | (() => Worker);
}

/** A LocalForage that imports the library and opens the store on the first call. */
function lazyLocalForage(options: LocalForageOptions): LocalForage {
    let instance: Promise<LocalForage> | undefined;
    const store = () => instance ??= import("localforage").then(module => module.default.createInstance(options));
    return {
        ready: (...args: Parameters<LocalForage["ready"]>) => store().then(value => value.ready(...args)),
        getItem: (...args: Parameters<LocalForage["getItem"]>) => store().then(value => value.getItem(...args)),
        setItem: (...args: Parameters<LocalForage["setItem"]>) => store().then(value => value.setItem(...args)),
        removeItem: (...args: Parameters<LocalForage["removeItem"]>) => store().then(value => value.removeItem(...args)),
        clear: (...args: Parameters<LocalForage["clear"]>) => store().then(value => value.clear(...args)),
        length: (...args: Parameters<LocalForage["length"]>) => store().then(value => value.length(...args)),
        keys: (...args: Parameters<LocalForage["keys"]>) => store().then(value => value.keys(...args)),
        iterate: (...args: Parameters<LocalForage["iterate"]>) => store().then(value => value.iterate(...args))
    } as LocalForage;
}

/**
 * {@link EnvProvider} backed by the DOM. Uses nothing outside of standard browser APIs and
 * localforage, so it stays free of Node polyfills.
 */
export class BrowserEnv implements EnvProvider {

    public readonly name = "browser";

    constructor(public readonly options: BrowserEnvOptions = {}) {}

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
        return new BrowserCache(lazyLocalForage({
            // IndexedDB schema upgrades retain records; each cache generation needs its own database.
            name: name + version,
            version: version
        }));
    }

    createWorker(name: "section"): Worker | undefined {
        if (name !== "section" || typeof Worker === "undefined") return undefined;
        try {
            const sectionWorker = this.options.sectionWorker;
            if (typeof sectionWorker === "function") return sectionWorker();
            if (sectionWorker !== undefined) return new Worker(sectionWorker, { type: "module" });
            // Keep the literal URL so bundlers emit the worker file next to the entry.
            return new Worker(new URL("./section.worker.mjs", import.meta.url), { type: "module" });
        } catch (error) {
            log.warn("Could not start the section worker, so sections build on the main thread. Pass sectionWorker to registerBrowserEnv to load it from another URL.", error);
            return undefined;
        }
    }

}

/** Installs the browser provider. The browser package entry calls this automatically. */
export function registerBrowserEnv(options?: BrowserEnvOptions): BrowserEnv {
    const env = new BrowserEnv(options);
    Env.register(env);
    return env;
}
