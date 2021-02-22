import { CompatImage, createImage } from "../CanvasCompat";

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

    public static load(src: string, onload?: () => void, onerr?: (err: Error) => void): CompatImage {
        const image = this._createImage();
        image.src = src;
        if (onload)
            image.onload = onload;
        if (onerr)
            image.onerror = onerr;
        return image;
    }


}
