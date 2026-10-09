import type { AnvilChunk } from "./AnvilParser";

/** Loads chunk columns at absolute integer chunk coordinates. */
export interface WorldChunkSource {
    /** Returns the requested column, or `undefined` if absent. Honor signal to cancel discarded reads. */
    getChunk(x: number, z: number, signal?: AbortSignal): Promise<AnvilChunk | undefined>;
}
