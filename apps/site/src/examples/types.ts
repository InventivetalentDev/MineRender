import type { Renderer, RendererOptions } from "minerender";

export interface ExampleContext {
    renderer: Renderer;
    /** Aborted when the viewport is suspended or switches to another example. */
    signal: AbortSignal;
    /** Mount point for optional per-example controls (inputs, toggles). */
    controls: HTMLElement;
    /** Shows the viewport's loading indicator until the work settles. Returns the same promise. */
    track<T>(work: Promise<T>, label?: string): Promise<T>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Example {
    id: string;
    title: string;
    /** One or two sentences shown under the title. */
    description: string;
    /** Renderer options merged over the viewport defaults (camera, composer, ...). */
    renderer?: DeepPartial<RendererOptions>;
    /** Builds the scene. Return a cleanup function for anything the renderer does not own. */
    setup(context: ExampleContext): Promise<void | (() => void)>;
    /** Code shown next to the viewport. Keep it equivalent to setup(). */
    code: {
        esm: string;
        script?: string;
    };
    /** Static image shown before the viewport activates. */
    placeholder?: string;
}

export interface ExampleGroup {
    id: string;
    title: string;
    lead: string;
    examples: Example[];
    /** Optional notes rendered under the showcase. */
    notes?: string[];
}

/** Resolves once the signal aborts, for cancelling awaited work in setup(). */
export function aborted(signal: AbortSignal): boolean {
    return signal.aborted;
}
