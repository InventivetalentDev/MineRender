import { CompatImage, createCanvas, createImage } from "../canvas/CanvasCompat";
import { serializeImageKey } from "../cache/CacheKey";
import { Caching } from "../cache/Caching";
import { AxiosResponse } from "axios";
import { Env } from "../Env";
import { Requests } from "../request/Requests";
import { WrappedImage } from "../WrappedImage";
import { ExtractableImageData } from "../ExtractableImageData";
import { Buffer } from "buffer";
import { prefix } from "../util/log";

const p = prefix("ImageLoader");

export interface ImageInfo {
    src?: string;
    width: number;
    height: number;
    type?: string;
    data: Buffer;
}

export class ImageLoader {

    protected static _createImage(): CompatImage {
        return createImage();
    }

    public static async loadAsync(src: string): Promise<CompatImage> {
        return new Promise<CompatImage>((resolve, reject) => {
            const image = this._createImage();
            image.onload = () => resolve(image);
            image.onerror = (err: Error) => reject(err instanceof Error ? err : new Error("Failed to decode image"));
            // Node images can finish decoding synchronously when src is assigned.
            image.src = src;
        });
    }

    public static loadElement(src: string, onload?: () => void, onerr?: (err: Error) => void): CompatImage {
        const image = this._createImage();
        if (onload)
            image.onload = onload;
        if (onerr)
            image.onerror = onerr;
        image.src = src;
        return image;
    }

    public static async loadData(src: string): Promise<ImageData> {
        console.debug(p, "loadData", src);
        const image = await this.loadCanvasData(src);
        return image.data.getImageData(0, 0, image.width, image.height);
    }

    public static async loadCanvasData(src: string): Promise<ExtractableImageData> {
        const keyStr = serializeImageKey({ src });
        const info = this.getInfo(src);
        const cached = Caching.rawImageCache.getIfPresent(keyStr);
        try {
            return await this.infoToCanvasData(await info);
        } catch (err) {
            // A valid header can still contain corrupt pixels. Retry the fetch after a decode
            // failure, without evicting a replacement inserted while this load was pending.
            if (cached && Caching.rawImageCache.getIfPresent(keyStr) === cached) {
                Caching.rawImageCache.invalidate(keyStr);
            }
            throw err;
        }
    }

    public static async infoToCanvasData(info: ImageInfo): Promise<ExtractableImageData> {
        const type = info.type === "jpg" ? "jpeg" : info.type ?? "png";
        // Both browser and Node images accept data URLs; src remains provenance, not a second fetch.
        const image = await ImageLoader.loadAsync(`data:image/${type};base64,${info.data.toString("base64")}`);
        const canvas = createCanvas(info.width, info.height);
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.drawImage(image as CanvasImageSource, 0, 0);
        return {
            data: context,
            width: info.width,
            height: info.height
        }
    }


    public static async infoToData(info: ImageInfo): Promise<ImageData> {
        const image = await this.infoToCanvasData(info);
        return image.data.getImageData(0, 0, image.width, image.height);
    }

    public static async getData(src: string): Promise<ImageData> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.imageDataCache.get(keyStr, k => {
            return ImageLoader.loadData(src);
        }))!;
    }

    public static async getCanvasData(src: string): Promise<ExtractableImageData> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.canvasImageDataCache.get(keyStr, k => {
            return ImageLoader.loadCanvasData(src);
        }))!;
    }

    public static async processResponse(response: Partial<AxiosResponse>): Promise<ImageInfo> {
        const src = response.config?.url;
        const data = Buffer.from(response.data!);
        const { width, height, type } = Env.provider.imageSize(data);
        if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
            throw new Error("Invalid or unsupported image dimensions");
        }
        return {
            src,
            width,
            height,
            type,
            data: data
        }
    }


    public static async loadInfo(src: string): Promise<ImageInfo> {

        // axios doesn't like data urls
        if (src.startsWith("data:image/png;base64")) {
            return this.processResponse({
                config: {
                    url: src
                },
                data: Buffer.from(src.substr("data:image/png;base64,".length), "base64")
            })
        }

        //TODO: figure out a way to allow data/base64 requests
        return Requests.genericRequest({
            url: src,
            responseType: "arraybuffer"
        })
            .then(this.processResponse);
    }

    public static async getInfo(src: string): Promise<ImageInfo> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.rawImageCache.get(keyStr, k => {
            return ImageLoader.loadInfo(src);
        }))!;
    }

    public static async loadWrapped(src: string): Promise<WrappedImage> {
        const data = await this.getCanvasData(src);
        return new WrappedImage(data);
    }

    public static async getWrapped(src: string): Promise<WrappedImage> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.wrappedImageCache.get(keyStr, k => {
            return ImageLoader.loadWrapped(src);
        }))!;
    }


}
