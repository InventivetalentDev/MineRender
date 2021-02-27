import { CompatImage, createImage } from "../CanvasCompat";
import { serializeImageKey } from "../cache/CacheKey";
import { Caching } from "../cache/Caching";
import { AxiosResponse } from "axios";
import imageSize from "image-size";
import { Requests } from "../request/Requests";
import { SSAOPassOUTPUT } from "three/examples/jsm/postprocessing/SSAOPass";
import { WrappedImage } from "../WrappedImage";

export interface ImageInfo {
    src?: string;
    width: number;
    height: number;
    type?: string;
    data: Buffer;
}

export class ImageLoader {

    protected static _createImage(): CompatImage {
        //TODO: probably needs cross-origin stuff set for browser
        return createImage();
    }

    public static async loadAsync(src: string): Promise<CompatImage> {
        return new Promise<CompatImage>((resolve, reject) => {
            const image = this._createImage();
            image.src = src;
            image.onload = () => resolve(image);
            image.onerror = (err: Error) => reject(err);
        });
    }

    public static loadElement(src: string, onload?: () => void, onerr?: (err: Error) => void): CompatImage {
        const image = this._createImage();
        image.src = src;
        if (onload)
            image.onload = onload;
        if (onerr)
            image.onerror = onerr;
        return image;
    }

    public static async loadData(src: string): Promise<ImageData> {
        return this.infoToData(await this.loadInfo(src));
    }

    public static infoToData(info: ImageInfo): ImageData {
        return new ImageData(new Uint8ClampedArray(info.data), info.width, info.height)
    }

    public static async getData(src: string): Promise<ImageData> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.imageDataCache.get(keyStr, k => {
            return ImageLoader.loadData(src);
        }))!;
    }

    public static processResponse(response: AxiosResponse): ImageInfo {
        const src = response.config.url;
        console.log(typeof response.data);
        const data = response.data as Buffer;
        const { width, height, type } = imageSize(data);
        return {
            src,
            width: width || 0,
            height: height || 0,
            type,
            data
        }
    }


    public static async loadInfo(src: string): Promise<ImageInfo> {
        return Requests.genericRequest({
            url: src,
            responseType: "arraybuffer"
        }).then(this.processResponse);
    }

    public static async getInfo(src: string): Promise<ImageInfo> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.rawImageCache.get(keyStr, k => {
            return ImageLoader.loadInfo(src);
        }))!;
    }

    public static async loadWrapped(src: string): Promise<WrappedImage> {
        const data = await this.getData(src);
        return new WrappedImage(data);
    }

    public static async getWrapped(src: string): Promise<WrappedImage> {
        const keyStr = serializeImageKey({ src });
        return (await Caching.wrappedImageCache.get(keyStr, k => {
            return ImageLoader.loadInfo(src);
        }))!;
    }


}
