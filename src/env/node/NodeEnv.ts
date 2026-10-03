import * as nodeCanvas from "canvas";
import imageSize from "image-size";
import NodePersist from "node-persist";
import { Env, EnvProvider, ImageSizeInfo } from "../../Env";
import type { CompatCanvas, CompatImage } from "../../canvas/CanvasCompat";
import type { PersistentCache } from "../../cache/PersistentCache";
import { NodeCache } from "./NodeCache";

/**
 * {@link EnvProvider} for headless Node.
 *
 * This is the only place in the library allowed to reach for Node-only modules. Nothing here may
 * be imported from `src/index.ts` - it is reachable exclusively through the `src/index.node.ts`
 * entry, which is what keeps `canvas` and friends out of the browser bundle.
 *
 * `canvas` is an optional dependency: browser-only consumers never install its native binary.
 * Importing this module without it will fail, which is intended - rasterisation under Node needs it.
 */
export class NodeEnv implements EnvProvider {

    public readonly name = "node";

    createCanvas(width: number, height: number): CompatCanvas {
        return nodeCanvas.createCanvas(width, height);
    }

    createImage(width?: number, height?: number): CompatImage {
        const image = new nodeCanvas.Image();
        if (width) image.width = width;
        if (height) image.height = height;
        return image;
    }

    imageSize(data: Uint8Array): ImageSizeInfo {
        return imageSize(Buffer.isBuffer(data) ? data : Buffer.from(data));
    }

    openCache(name: string, version: number): PersistentCache {
        return new NodeCache(NodePersist.create({
            dir: name + version,
            encoding: "utf8"
        }));
    }

}

export function registerNodeEnv(): NodeEnv {
    const env = new NodeEnv();
    Env.register(env);
    return env;
}
