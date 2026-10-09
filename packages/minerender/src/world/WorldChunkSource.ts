import type { AnvilChunk } from "./AnvilParser";

/** Loads chunk columns at absolute integer chunk coordinates. */
export interface WorldChunkSource {
    /** Returns the requested column, or `undefined` if it is absent. */
    getChunk(x: number, z: number): Promise<AnvilChunk | undefined>;
}
