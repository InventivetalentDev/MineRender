import { Buffer } from "node:buffer";
import { Renderer, RendererOptions, RendererSurface } from "../../renderer/Renderer";
import type { DeepPartial } from "../../util/util";

/** Renderer settings and logical image dimensions for {@link NodeRenderer.create}. */
export type NodeRendererOptions = DeepPartial<RendererOptions> & {
    width: number;
    height: number;
};

/** PNG export settings for {@link NodeRenderer.renderToBuffer}. */
export interface NodeImageOptions {
    /** Removes transparent borders. An empty image becomes one transparent pixel. */
    trim?: boolean;
}

function headlessOptions(options: DeepPartial<RendererOptions>): DeepPartial<RendererOptions> {
    if (options.render?.stats || options.render?.autoResize || options.controls?.enabled) {
        throw new Error("NodeRenderer requires render.stats, render.autoResize, and controls.enabled to be disabled");
    }
    return {
        ...options,
        render: { ...options.render, stats: false, autoResize: false },
        controls: { enabled: false }
    };
}

function imageSurface(surface: RendererSurface): RendererSurface {
    const attributes = surface.context.getContextAttributes();
    if (!attributes) throw new Error("NodeRenderer requires a usable WebGL 2 context");
    if (attributes.alpha && attributes.premultipliedAlpha !== true) {
        throw new Error("NodeRenderer PNG capture requires premultipliedAlpha: true for contexts with alpha enabled");
    }
    return surface;
}

/** Renders individual frames in Node using an injected or factory-owned WebGL 2 context. */
export class NodeRenderer extends Renderer {

    private destroyContext?: () => void;
    private nodeDisposed = false;

    /**
     * Uses a caller-owned surface; alpha-enabled contexts require `premultipliedAlpha: true`.
     * Disposal releases renderer resources but retains the canvas and context.
     */
    constructor(options: DeepPartial<RendererOptions>, surface: RendererSurface) {
        super(headlessOptions(options), imageSurface(surface));
    }

    /**
     * Creates an owned native context through the optional `gl` package. Dimensions are in logical pixels.
     * Native antialiasing is unavailable; increase `render.pixelRatio` for a larger output image.
     */
    public static async create(options: NodeRendererOptions): Promise<NodeRenderer> {
        const { width, height, ...settings } = options;
        const renderOptions = headlessOptions(settings);
        if (renderOptions.render?.antialias) {
            throw new Error("Native gl does not support antialiasing; increase render.pixelRatio instead");
        }
        renderOptions.render = { ...renderOptions.render, antialias: false };
        const pixelRatio = renderOptions.render?.pixelRatio ?? 1;
        const physicalWidth = Math.floor(width * pixelRatio), physicalHeight = Math.floor(height * pixelRatio);
        if (![width, height, physicalWidth, physicalHeight].every(value => Number.isSafeInteger(value) && value > 0)
            || !Number.isFinite(pixelRatio) || pixelRatio <= 0) {
            throw new RangeError("NodeRenderer dimensions and drawing-buffer dimensions must be positive safe integers");
        }

        let createContext: typeof import("gl");
        try {
            createContext = (await import("gl")).default;
        } catch (cause) {
            throw Object.assign(new Error("NodeRenderer.create() requires the optional gl package with native WebGL 2 support"), { cause });
        }
        const context = createContext(physicalWidth, physicalHeight, {
            createWebGL2Context: true,
            alpha: true,
            depth: true,
            antialias: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: true
        });
        if (!context) throw new Error("gl could not create a native WebGL 2 context");

        const destroy = context.getExtension("STACKGL_destroy_context");
        try {
            const resize = context.getExtension("STACKGL_resize_drawingbuffer");
            if (!destroy || !resize) throw new Error("gl requires context destruction and drawing-buffer resize support");
            const canvas: RendererSurface["canvas"] = {
                width: physicalWidth,
                height: physicalHeight,
                addEventListener() {},
                removeEventListener() {}
            };
            Object.assign(context, { canvas });
            const renderer = new NodeRenderer(renderOptions, {
                canvas, context, width, height,
                resize: (bufferWidth, bufferHeight) => resize.resize(bufferWidth, bufferHeight)
            });
            renderer.destroyContext = () => destroy.destroy();
            return renderer;
        } catch (error) {
            destroy?.destroy();
            throw error;
        }
    }

    /** Draws and returns a PNG with straight alpha, including while stopped. Frame callbacks are not invoked. */
    public async renderToBuffer(options: NodeImageOptions = {}): Promise<Buffer> {
        if (this.nodeDisposed) throw new Error("Cannot export an image from a disposed renderer");
        const renderer = this.renderer;
        const target = renderer.getRenderTarget();
        const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
        const context = renderer.getContext();
        let width: number, height: number, raw: Uint8Array;
        try {
            renderer.setRenderTarget(null);
            this.renderOnce();
            renderer.setRenderTarget(null);
            width = context.drawingBufferWidth;
            height = context.drawingBufferHeight;
            raw = new Uint8Array(width * height * 4);
            context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, raw);
        } finally {
            renderer.setRenderTarget(target, face, level);
        }

        const pixels = new Uint8Array(raw.length);
        const premultiplied = context.getContextAttributes()?.premultipliedAlpha;
        let left = width, top = height, right = -1, bottom = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const source = ((height - 1 - y) * width + x) * 4;
                const destination = (y * width + x) * 4;
                const alpha = raw[source + 3];
                for (let channel = 0; channel < 3; channel++) {
                    pixels[destination + channel] = premultiplied
                        ? alpha > 0 ? Math.min(255, Math.round(raw[source + channel] * 255 / alpha)) : 0
                        : raw[source + channel];
                }
                pixels[destination + 3] = alpha;
                if (options.trim && alpha > 0) {
                    left = Math.min(left, x);
                    top = Math.min(top, y);
                    right = Math.max(right, x);
                    bottom = Math.max(bottom, y);
                }
            }
        }

        let data = pixels;
        if (options.trim) {
            const croppedWidth = right < left ? 1 : right - left + 1;
            const croppedHeight = right < left ? 1 : bottom - top + 1;
            data = new Uint8Array(croppedWidth * croppedHeight * 4);
            if (right >= left) {
                for (let y = 0; y < croppedHeight; y++) {
                    const start = ((top + y) * width + left) * 4;
                    data.set(pixels.subarray(start, start + croppedWidth * 4), y * croppedWidth * 4);
                }
            }
            width = croppedWidth;
            height = croppedHeight;
        }
        const { encode } = await import("fast-png");
        return Buffer.from(encode({ width, height, data, channels: 4, depth: 8 }));
    }

    /** Node renderers draw on demand. Use {@link renderOnce} or {@link renderToBuffer}. */
    public override start(): never {
        throw new Error("NodeRenderer does not run an animation loop; use renderOnce() or renderToBuffer()");
    }

    /** Node image capture returns encoded bytes through {@link renderToBuffer}. */
    public override toImage(_trim: boolean = false, _mime: string = "image/png", _quality?: number): never {
        throw new Error("NodeRenderer does not export canvas data URLs; use renderToBuffer()");
    }

    /** Releases renderer resources and destroys contexts created by {@link create}. */
    public override dispose(): void {
        this.nodeDisposed = true;
        try {
            super.dispose();
        } finally {
            const destroy = this.destroyContext;
            this.destroyContext = undefined;
            destroy?.();
        }
    }
}
