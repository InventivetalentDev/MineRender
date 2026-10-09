import type { Renderer, RendererOptions } from "minerender";
import type { PerspectiveCamera } from "three";
import type { DeepPartial } from "../examples/types";
import type { Overlay } from "./overlay";

export interface ShotContext {
    renderer: Renderer;
    camera: PerspectiveCamera;
    /** Aborted when the shot is unloaded; passed through to example setups. */
    signal: AbortSignal;
    overlay: Overlay;
    width: number;
    height: number;
    /** True for the vertical cut; shots may reframe the camera. */
    portrait: boolean;
}

export interface Shot {
    id: string;
    /** Length on the timeline. Crossfades overlap the ends by the join's transition length. */
    seconds: number;
    /** Renderer options merged over the stage defaults (camera, composer). */
    renderer?: DeepPartial<RendererOptions>;
    /**
     * Loads everything the shot needs. The clock is in realtime mode here, so request queues
     * work, and nothing of this time appears in the video.
     */
    prepare(context: ShotContext): Promise<void>;
    /** Called once per frame with the shot-local time in seconds, before the frame is drawn. */
    update(context: ShotContext, t: number): void;
}
