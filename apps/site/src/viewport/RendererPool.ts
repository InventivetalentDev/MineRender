/**
 * Keeps the number of live WebGL renderers on the page small.
 *
 * The V1 site created one renderer per example card and kept all of them animating, which
 * exhausted WebGL contexts and GPU time on weaker machines. Here every viewport asks the pool
 * before it creates a renderer; when the pool is full, the least recently used viewport is
 * suspended (it keeps a snapshot image and releases its renderer).
 */
export interface Pooled {
    /** Release the renderer; the owner keeps a snapshot so the page does not go blank. */
    suspend(): void;
    /** How far the viewport is from the centre of the screen; farther ones are evicted first. */
    distanceToViewport(): number;
}

export class RendererPool {
    private readonly active: Pooled[] = [];

    constructor(public maxActive: number = 2) {
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                // Background tabs do not need live renderers at all.
                for (const entry of [...this.active]) entry.suspend();
            }
        });
    }

    /**
     * Registers a viewport as active. Over the limit, the viewport farthest from the centre of
     * the screen is suspended first (recency breaks ties), so the one being looked at survives.
     */
    acquire(entry: Pooled): void {
        this.touch(entry);
        while (this.active.length > this.maxActive) {
            const candidates = this.active.filter(candidate => candidate !== entry);
            if (candidates.length === 0) break;
            let victim = candidates[0];
            for (const candidate of candidates) {
                if (candidate.distanceToViewport() > victim.distanceToViewport()) victim = candidate;
            }
            this.release(victim);
            victim.suspend();
        }
    }

    /** Marks the viewport as most recently used, for example after user interaction. */
    touch(entry: Pooled): void {
        this.release(entry);
        this.active.push(entry);
    }

    release(entry: Pooled): void {
        const index = this.active.indexOf(entry);
        if (index >= 0) this.active.splice(index, 1);
    }

    get size(): number {
        return this.active.length;
    }
}

export const rendererPool = new RendererPool(2);
