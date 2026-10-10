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
    private readonly loadingText: HTMLElement;
    private readonly controlsHost: HTMLElement;

    private renderer?: Renderer;
    private abort?: AbortController;
    private cleanup?: () => void;
    private example?: Example;
    private state: State = "idle";
    private visible = false;
    /** Control-triggered loads in flight, shown with the loading indicator. */
    private pending = 0;
    private readonly observer: IntersectionObserver;

    constructor(container: HTMLElement, private readonly viewportOptions: ViewportOptions = {}) {
        this.element = container;
        container.classList.add("viewport");
        container.innerHTML = `
            <div class="viewport-surface"></div>
            <img class="viewport-snapshot" alt="" draggable="false">
            <div class="viewport-controls"></div>
            <div class="viewport-loading" role="status" aria-live="polite">
                <span class="viewport-loading-badge">
                    <span class="viewport-loading-bar" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
                    <span class="viewport-loading-text"></span>
                </span>
            </div>
            <button class="viewport-overlay" type="button">
                <span class="viewport-overlay-text"></span>
            </button>
        `;
        this.surface = container.querySelector(".viewport-surface")!;
        this.snapshot = container.querySelector(".viewport-snapshot")!;
        this.overlay = container.querySelector(".viewport-overlay")!;
        this.overlayText = container.querySelector(".viewport-overlay-text")!;
        this.loadingText = container.querySelector(".viewport-loading-text")!;
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

        // Control changes load new assets whose textures arrive after the next draw.
        for (const type of ["change", "input"]) {
            this.controlsHost.addEventListener(type, () => {
                if (this.renderer && this.abort && this.state === "active") this.settle(this.renderer, this.abort.signal);
            });
        }

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
        const options = mergeOptions(DEFAULT_OPTIONS, {
            // Keep GPU work proportional to the element, not to a Retina screen.
            render: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) },
            ...example.renderer
        });
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
        renderer.appendTo(this.surface);
        if (renderer.orbitControls) {
            renderer.orbitControls.enableDamping = true;
            renderer.orbitControls.dampingFactor = 0.12;
        }
        renderer.start();

        const track = <T>(work: Promise<T>, label?: string) => this.track(work, label, signal);
        example.setup({ renderer, signal, controls: this.controlsHost, track }).then(cleanup => {
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

    /** Shows the loading indicator until the work settles, then requests a few redraws. */
    private track<T>(work: Promise<T>, label: string | undefined, signal: AbortSignal): Promise<T> {
        this.pending++;
        this.updateLoading(label);
        const done = () => {
            // teardown() already reset the counter for an aborted viewport
            if (signal.aborted) return;
            this.pending = Math.max(0, this.pending - 1);
            this.updateLoading();
            if (this.renderer && this.state === "active") this.settle(this.renderer, signal);
        };
        work.then(done, done);
        return work;
    }

    private updateLoading(label?: string): void {
        const busy = this.state === "loading" || this.pending > 0;
        if (label) this.loadingText.textContent = label;
        else if (this.state === "loading") this.loadingText.textContent = "Loading assets…";
        else if (busy && !this.loadingText.textContent) this.loadingText.textContent = "Loading…";
        this.element.classList.toggle("is-busy", busy);
        this.element.setAttribute("aria-busy", String(busy));
        if (!busy) this.loadingText.textContent = "";
    }

    /**
     * Textures finish decoding after setup() resolves and do not mark the scene dirty yet,
     * so request a few redraws while the first frames settle.
     */
    private settleUntil = 0;

    private settle(renderer: Renderer, signal: AbortSignal): void {
        const alreadyRunning = this.settleUntil > performance.now();
        this.settleUntil = performance.now() + 6000;
        if (alreadyRunning) return;
        const tick = () => {
            if (signal.aborted || this.renderer !== renderer) return;
            renderer.dirty = true;
            if (performance.now() < this.settleUntil) setTimeout(tick, 250);
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
            // toImage renders a fresh frame before reading the canvas.
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
        this.pending = 0;
        rendererPool.release(this);
        this.renderer?.dispose();
        this.renderer = undefined;
        this.surface.innerHTML = "";
        this.controlsHost.innerHTML = "";
    }

    private setState(state: State, message?: string): void {
        this.state = state;
        this.element.dataset.state = state;
        this.overlayText.textContent = state === "loading" ? "" : message ?? "";
        this.overlay.classList.toggle("is-hidden", state === "active" || state === "loading" || this.viewportOptions.overlay === false);
        this.updateLoading();
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
