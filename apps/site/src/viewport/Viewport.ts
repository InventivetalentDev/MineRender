import { Renderer, RendererOptions } from "minerender";
import type { Example } from "../examples/types";
import { rendererPool, type Pooled } from "./RendererPool";

type State = "idle" | "loading" | "active" | "suspended" | "error";

const DEFAULT_OPTIONS = {
    camera: {
        near: 1,
        far: 5000,
        position: [40, 30, 50] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    },
    render: {
        fpsLimit: 60,
        antialias: true,
        stats: false
    },
    composer: {
        enabled: false
    },
    controls: {
        enabled: true
    },
    debug: {
        grid: false,
        axes: false
    }
};

/**
 * A lazily activated render surface.
 *
 * The renderer is only created while the element is near the viewport and the pool has room.
 * Leaving the viewport or being evicted from the pool suspends it: the last frame is kept as a
 * snapshot image and the WebGL context is released.
 */
export interface ViewportOptions {
    /** Called whenever the viewport changes state, for custom status displays. */
    onStatus?: (state: State, message: string) => void;
    /** Hide the built-in overlay pill (the host renders its own status). */
    overlay?: boolean;
}

export type ViewportState = State;

export class Viewport implements Pooled {
    readonly element: HTMLElement;
    private readonly surface: HTMLElement;
    private readonly snapshot: HTMLImageElement;
    private readonly overlay: HTMLButtonElement;
    private readonly overlayText: HTMLElement;
    private readonly controlsHost: HTMLElement;

    private renderer?: Renderer;
    private abort?: AbortController;
    private cleanup?: () => void;
    private example?: Example;
    private state: State = "idle";
    private visible = false;
    private readonly observer: IntersectionObserver;

    constructor(container: HTMLElement, private readonly viewportOptions: ViewportOptions = {}) {
        this.element = container;
        container.classList.add("viewport");
        container.innerHTML = `
            <div class="viewport-surface"></div>
            <img class="viewport-snapshot" alt="" draggable="false">
            <div class="viewport-controls"></div>
            <button class="viewport-overlay" type="button">
                <span class="viewport-overlay-text"></span>
            </button>
        `;
        this.surface = container.querySelector(".viewport-surface")!;
        this.snapshot = container.querySelector(".viewport-snapshot")!;
        this.overlay = container.querySelector(".viewport-overlay")!;
        this.overlayText = container.querySelector(".viewport-overlay-text")!;
        this.controlsHost = container.querySelector(".viewport-controls")!;

        this.overlay.addEventListener("click", () => {
            if (this.state === "suspended" || this.state === "idle" || this.state === "error") {
                this.activate();
            }
        });
        // Interacting with a viewport makes it the most recently used one.
        container.addEventListener("pointerdown", () => {
            if (this.renderer) rendererPool.touch(this);
        });

        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                this.visible = entry.isIntersecting;
                if (this.visible) {
                    if (this.state === "idle" || this.state === "suspended") this.activate();
                } else if (this.state === "active" || this.state === "loading") {
                    this.suspend();
                }
            }
        }, { rootMargin: "96px 0px" });
        this.observer.observe(container);

        this.setState("idle", "Scroll to load");
    }

    setExample(example: Example): void {
        const wasLive = this.state === "active" || this.state === "loading";
        this.teardown();
        this.example = example;
        this.snapshot.src = example.placeholder ?? "";
        this.snapshot.classList.toggle("is-hidden", !example.placeholder);
        this.setState("idle", "Scroll to load");
        if (wasLive || this.visible) this.activate();
    }

    /** Creates the renderer and runs the example setup. */
    activate(): void {
        if (!this.example) return;
        if (this.state === "active" || this.state === "loading") return;

        const example = this.example;
        const options = mergeOptions(DEFAULT_OPTIONS, example.renderer ?? {});
        let renderer: Renderer;
        try {
            renderer = new Renderer(options);
        } catch (error) {
            console.error(error);
            this.setState("error", "WebGL is not available. Click to retry.");
            return;
        }
        this.renderer = renderer;
        this.abort = new AbortController();
        const signal = this.abort.signal;
        rendererPool.acquire(this);

        this.controlsHost.innerHTML = "";
        this.setState("loading", "Loading assets…");
        // Keep GPU work proportional to the element, not to a Retina screen.
        renderer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.appendTo(this.surface);
        if (renderer.controls) {
            renderer.controls.enableDamping = true;
            renderer.controls.dampingFactor = 0.12;
        }
        renderer.start();

        example.setup({ renderer, signal, controls: this.controlsHost }).then(cleanup => {
            if (signal.aborted) {
                cleanup?.();
                return;
            }
            this.cleanup = cleanup ?? undefined;
            this.setState("active");
            this.snapshot.classList.add("is-hidden");
            this.settle(renderer, signal);
        }).catch(error => {
            if (signal.aborted) return;
            console.error(`Example "${example.id}" failed`, error);
            this.setState("error", "Failed to load this example. Click to retry.");
        });
    }

    /**
     * Textures finish decoding after setup() resolves and do not mark the scene dirty yet,
     * so request a few redraws while the first frames settle.
     */
    private settle(renderer: Renderer, signal: AbortSignal): void {
        const started = performance.now();
        const tick = () => {
            if (signal.aborted) return;
            renderer.dirty = true;
            if (performance.now() - started < 6000) setTimeout(tick, 250);
        };
        tick();
    }

    /** Distance from the element's centre to the viewport centre; the pool evicts the farthest. */
    distanceToViewport(): number {
        const rect = this.element.getBoundingClientRect();
        const centre = rect.top + rect.height / 2;
        return Math.abs(centre - window.innerHeight / 2);
    }

    /** Keeps a snapshot of the last frame and releases the renderer. */
    suspend(): void {
        if (!this.renderer) return;
        const image = this.state === "active" ? this.capture() : undefined;
        this.teardown();
        if (image) {
            this.snapshot.src = image;
            this.snapshot.classList.remove("is-hidden");
        }
        this.setState("suspended", "Paused to save resources. Click to resume.");
    }

    dispose(): void {
        this.observer.disconnect();
        this.teardown();
    }

    get currentRenderer(): Renderer | undefined {
        return this.renderer;
    }

    get currentState(): State {
        return this.state;
    }

    /** Rebuilds the current example if it is live, for example after the asset sources changed. */
    reload(): void {
        if (!this.example) return;
        if (this.state === "active" || this.state === "loading") this.setExample(this.example);
    }

    /** Returns the camera to the example's starting view. */
    resetView(): void {
        const renderer = this.renderer;
        if (!renderer) return;
        renderer.controls?.reset();
        renderer.dirty = true;
    }

    private capture(): string | undefined {
        const renderer = this.renderer;
        if (!renderer) return undefined;
        try {
            // toDataURL only sees the drawing buffer within the same task as the draw call.
            if (renderer.options.composer.enabled && renderer.composer) {
                renderer.composer.render();
            } else {
                renderer.renderer.render(renderer.scene, renderer.camera);
            }
            return renderer.toImage();
        } catch (error) {
            console.warn("Could not capture viewport snapshot", error);
            return undefined;
        }
    }

    private teardown(): void {
        this.abort?.abort();
        this.abort = undefined;
        try {
            this.cleanup?.();
        } catch (error) {
            console.warn(error);
        }
        this.cleanup = undefined;
        rendererPool.release(this);
        this.renderer?.dispose();
        this.renderer = undefined;
        this.surface.innerHTML = "";
        this.controlsHost.innerHTML = "";
    }

    private setState(state: State, message?: string): void {
        this.state = state;
        this.element.dataset.state = state;
        this.overlayText.textContent = message ?? "";
        this.overlay.classList.toggle("is-hidden", state === "active" || this.viewportOptions.overlay === false);
        this.overlay.disabled = state === "loading";
        this.viewportOptions.onStatus?.(state, message ?? "");
    }
}

type AnyRecord = Record<string, unknown>;

function mergeOptions<T extends AnyRecord>(base: T, patch: AnyRecord): T {
    const result: AnyRecord = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const current = result[key];
        if (isPlainObject(value) && isPlainObject(current)) {
            result[key] = mergeOptions(current, value);
        } else {
            result[key] = value;
        }
    }
    return result as T;
}

function isPlainObject(value: unknown): value is AnyRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export type { RendererOptions };
